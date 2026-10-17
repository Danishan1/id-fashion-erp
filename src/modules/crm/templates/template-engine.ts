import {
  RENDERED_MAX_SUBJECT,
  SAMPLE_VALUES,
  TEMPLATE_CHANNELS,
  TEMPLATE_ENTITIES,
  TEMPLATE_MAX_SUBJECT,
  TEMPLATE_VARIABLE_MAP,
  UNAVAILABLE_ENTITIES,
  isTemplateChannel,
  type TemplateEntity,
  type TemplateIssue,
} from "./template-registry";

/**
 * The one template parser / renderer (Phase 12). Pure and client-safe: the
 * server uses it to validate, preview and send; the editor uses the same code
 * for its live sample preview, so both always agree.
 *
 * SYNTAX — one form only:
 *   {{entity.field}}            e.g. {{contact.first_name}}
 *   {{entity.field|fallback}}   e.g. {{contact.first_name|there}}
 * Spaces inside the braces are ignored ({{ contact.first_name | there }}).
 * The fallback is literal text (no braces, no line breaks, max 100 chars).
 * "{{" always starts a variable — there is no escape.
 *
 * POLICY (centralised here):
 *   unknown variable          → error (can't activate or send); rendered as empty
 *   malformed / unclosed {{   → error; left as typed so the preview shows it
 *   known variable, no value  → its fallback, else empty; warning NO_VALUE
 *   record not in the context → its fallback, else empty; one warning per record
 *                               ("Opportunity data is unavailable for this message.")
 * Values are inserted once and never re-parsed, so a value containing "{{"
 * stays plain text.
 */

export const VARIABLE_KEY_RE = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/;
export const MAX_FALLBACK_LENGTH = 100;

export interface TemplateToken {
  /** As typed, e.g. "{{ contact.first_name | there }}". */
  raw: string;
  key: string;
  entity: string;
  field: string;
  fallback: string | null;
  start: number;
  end: number;
  known: boolean;
}

type Field = "subject" | "body";

export interface ParsedText {
  /** Text and variable pieces in order (malformed variables stay as text). */
  parts: ({ type: "text"; text: string } | { type: "var"; token: TemplateToken })[];
  tokens: TemplateToken[];
  issues: TemplateIssue[];
}

const issue = (code: string, severity: TemplateIssue["severity"], message: string, extra: Partial<TemplateIssue> = {}): TemplateIssue => ({ code, severity, source: "template", message, ...extra });

export function parseTemplateText(text: string, field: Field = "body"): ParsedText {
  const parts: ParsedText["parts"] = [];
  const tokens: TemplateToken[] = [];
  const issues: TemplateIssue[] = [];
  let i = 0;
  let textStart = 0;
  const pushText = (end: number) => {
    if (end > textStart) parts.push({ type: "text", text: text.slice(textStart, end) });
  };
  while (i < text.length) {
    const open = text.indexOf("{{", i);
    if (open < 0) break;
    const close = text.indexOf("}}", open + 2);
    const nextOpen = text.indexOf("{{", open + 2);
    const newline = text.indexOf("\n", open + 2);
    if (close < 0 || (nextOpen >= 0 && nextOpen < close) || (newline >= 0 && newline < close)) {
      issues.push(issue("UNCLOSED_VARIABLE", "error", `A variable starting with "{{" isn't closed with "}}": ${JSON.stringify(text.slice(open, open + 30))}.`, { field }));
      i = open + 2;
      continue;
    }
    const raw = text.slice(open, close + 2);
    const inner = raw.slice(2, -2);
    const bar = inner.indexOf("|");
    const key = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
    const fallback = bar >= 0 ? inner.slice(bar + 1).trim() : null;
    if (!VARIABLE_KEY_RE.test(key)) {
      issues.push(issue("MALFORMED_VARIABLE", "error", `${raw} isn't a valid variable. Use the form {{record.field}}, e.g. {{contact.first_name}}.`, { field, variable: key }));
      i = close + 2;
      continue;
    }
    if (fallback !== null && (fallback.length > MAX_FALLBACK_LENGTH || /[{}]/.test(fallback))) {
      issues.push(issue("INVALID_FALLBACK", "error", `The fallback in ${raw} must be plain text of at most ${MAX_FALLBACK_LENGTH} characters, without braces.`, { field, variable: key }));
      i = close + 2;
      continue;
    }
    const [entity, fieldName] = key.split(".");
    const known = TEMPLATE_VARIABLE_MAP.has(key);
    if (!known) {
      const why = UNAVAILABLE_ENTITIES[entity];
      issues.push(issue("UNKNOWN_VARIABLE", "error", why ? `Template contains unsupported variable: {{${key}}}. ${why}` : `Template contains unsupported variable: {{${key}}}.`, { field, variable: key }));
    }
    pushText(open);
    const token: TemplateToken = { raw, key, entity, field: fieldName, fallback, start: open, end: close + 2, known };
    tokens.push(token);
    parts.push({ type: "var", token });
    textStart = close + 2;
    i = close + 2;
  }
  pushText(text.length);
  return { parts, tokens, issues };
}

/** Variable keys used in subject + body, in order of first use (unknown ones included). */
export function extractVariables(subject: string | null | undefined, body: string): string[] {
  const keys: string[] = [];
  for (const t of [...parseTemplateText(subject ?? "", "subject").tokens, ...parseTemplateText(body, "body").tokens]) if (!keys.includes(t.key)) keys.push(t.key);
  return keys;
}

// ── SMS length ──────────────────────────────────────────────────

const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";

/** GSM-7 vs Unicode and the number of SMS parts the text needs (concatenated SMS: 153 / 67 characters per part). */
export function smsInfo(text: string): { encoding: "GSM-7" | "Unicode"; units: number; segments: number } {
  let units = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) units += 1;
    else if (GSM_EXTENDED.includes(ch)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (!gsm) {
    units = text.length; // UTF-16 code units
    return { encoding: "Unicode", units, segments: units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67) };
  }
  return { encoding: "GSM-7", units, segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153) };
}

// ── Rendering ───────────────────────────────────────────────────

export type TemplateValues = Readonly<Record<string, string | null | undefined>>;

export interface RenderContext {
  /** Flat values keyed by variable ("contact.first_name"). */
  values: TemplateValues;
  /** Records present in this context. Variables of other records are "unavailable". "all" = every record (sample data). */
  available: ReadonlySet<TemplateEntity> | "all";
}

export interface RenderedTemplate {
  subject: string | null;
  body: string;
  /** Errors and warnings found while rendering (unknown variables, missing values / records…). */
  issues: TemplateIssue[];
  /** Each variable once, in order of first use in the body then the subject, with the value used — for providers with positional template parameters. */
  parameters: { key: string; value: string }[];
  /** Variables that rendered empty or used their fallback. */
  missing: { key: string; reason: "NO_VALUE" | "NO_CONTEXT"; usedFallback: boolean }[];
}

function renderPart(text: string, field: Field, ctx: RenderContext, state: { issues: TemplateIssue[]; params: Map<string, string>; missing: RenderedTemplate["missing"]; noContext: Set<string>; noValue: Set<string> }): string {
  const parsed = parseTemplateText(text, field);
  state.issues.push(...parsed.issues);
  let out = "";
  for (const part of parsed.parts) {
    if (part.type === "text") {
      out += part.text;
      continue;
    }
    const t = part.token;
    if (!t.known) continue; // unknown → empty (already an error)
    const entity = t.entity as TemplateEntity;
    const inContext = ctx.available === "all" || ctx.available.has(entity);
    const raw = inContext ? ctx.values[t.key] : null;
    let value = raw == null ? "" : String(raw).trim();
    if (field === "subject") value = value.replace(/\s*\n\s*/g, " ");
    if (!value) {
      const reason = inContext ? "NO_VALUE" : "NO_CONTEXT";
      if (!state.missing.some((m) => m.key === t.key)) state.missing.push({ key: t.key, reason, usedFallback: t.fallback !== null });
      if (reason === "NO_CONTEXT" && !state.noContext.has(entity)) {
        state.noContext.add(entity);
        state.issues.push(issue("NO_CONTEXT", "warning", `${TEMPLATE_ENTITIES[entity]?.label ?? entity} data is unavailable for this message.`, { field: "context", variable: t.key }));
      } else if (reason === "NO_VALUE" && t.fallback === null && !state.noValue.has(t.key)) {
        state.noValue.add(t.key);
        const def = TEMPLATE_VARIABLE_MAP.get(t.key)!;
        state.issues.push(issue("NO_VALUE", "warning", `${TEMPLATE_ENTITIES[def.entity].label} ${def.label.toLowerCase()} is empty — {{${t.key}}} will be blank. Add a fallback like {{${t.key}|…}} if that reads badly.`, { field, variable: t.key }));
      }
      value = t.fallback ?? "";
    }
    if (!state.params.has(t.key)) state.params.set(t.key, value);
    out += value;
  }
  return out;
}

/** Renders subject + body against a context. Deterministic: same inputs, same output. */
export function renderTemplateContent(content: { subject?: string | null; body: string }, ctx: RenderContext): RenderedTemplate {
  const state = { issues: [] as TemplateIssue[], params: new Map<string, string>(), missing: [] as RenderedTemplate["missing"], noContext: new Set<string>(), noValue: new Set<string>() };
  const body = renderPart(content.body, "body", ctx, state);
  const subject = content.subject == null ? null : renderPart(content.subject, "subject", ctx, state).trim();
  return { subject, body, issues: state.issues, parameters: [...state.params].map(([key, value]) => ({ key, value })), missing: state.missing };
}

/** Render with the built-in sample values (every record "present"). */
export function renderWithSampleData(content: { subject?: string | null; body: string }): RenderedTemplate {
  return renderTemplateContent(content, { values: SAMPLE_VALUES, available: "all" });
}

// ── Validation ──────────────────────────────────────────────────

export interface TemplateContentInput {
  channelType: string;
  subject?: string | null;
  body: string;
  providerMetadata?: Record<string, string> | null;
}

export interface TemplateValidation {
  valid: boolean;
  errors: TemplateIssue[];
  warnings: TemplateIssue[];
  variables: string[];
  /** Estimated with sample data. */
  sms?: ReturnType<typeof smsInfo>;
}

/** Length / channel rules on an already-rendered text (shared by validation and sending). */
export function checkRenderedLengths(channelType: string, rendered: { subject: string | null; body: string }, basis: "sample" | "actual"): TemplateIssue[] {
  if (!isTemplateChannel(channelType)) return [];
  const ch = TEMPLATE_CHANNELS[channelType];
  const out: TemplateIssue[] = [];
  const est = basis === "sample" ? " with sample data" : "";
  if (rendered.body.length > ch.maxBodyLength) out.push(issue("TOO_LONG", "error", `${ch.label} messages can be at most ${ch.maxBodyLength.toLocaleString("en-IN")} characters — this one is ${rendered.body.length.toLocaleString("en-IN")}${est}.`, { field: "body" }));
  else if (ch.recommendedMaxLength && rendered.body.length > ch.recommendedMaxLength) out.push(issue("LONG_MESSAGE", "warning", `${rendered.body.length.toLocaleString("en-IN")} characters${est}. ${ch.recommendedMaxReason ?? ""}`.trim(), { field: "body" }));
  if (ch.smsSegments) {
    const sms = smsInfo(rendered.body);
    if (sms.segments > 1) out.push(issue("SMS_SEGMENTS", "warning", `About ${sms.segments} SMS parts (${sms.encoding}${sms.encoding === "Unicode" ? ": 70 characters per single SMS, 67 per part" : ": 160 characters per single SMS, 153 per part"})${est}. Each part may be billed separately.`, { field: "body" }));
  }
  if (rendered.subject && rendered.subject.length > RENDERED_MAX_SUBJECT) out.push(issue("TOO_LONG", "error", `The subject can be at most ${RENDERED_MAX_SUBJECT} characters${est}.`, { field: "subject" }));
  return out;
}

/** CRM-level validation of template content (not provider rules — those come from the provider adapter). */
export function validateTemplateContent(input: TemplateContentInput): TemplateValidation {
  const issues: TemplateIssue[] = [];
  if (!isTemplateChannel(input.channelType)) {
    issues.push(issue("INVALID_CHANNEL", "error", "Choose a supported channel: Email, SMS or WhatsApp.", { field: "channelType" }));
    return { valid: false, errors: issues, warnings: [], variables: [] };
  }
  const ch = TEMPLATE_CHANNELS[input.channelType];
  const subject = input.subject ?? null;
  if (ch.subject === "required" && !subject?.trim()) issues.push(issue("SUBJECT_REQUIRED", "error", "An email template needs a subject.", { field: "subject" }));
  if (ch.subject === "none" && subject?.trim()) issues.push(issue("SUBJECT_NOT_ALLOWED", "error", `${ch.label} messages have no subject line.`, { field: "subject" }));
  if (subject && subject.length > TEMPLATE_MAX_SUBJECT) issues.push(issue("TOO_LONG", "error", `The subject can be at most ${TEMPLATE_MAX_SUBJECT} characters.`, { field: "subject" }));
  if (!input.body.trim()) issues.push(issue("BODY_REQUIRED", "error", "Write the message text.", { field: "body" }));
  if (subject && /\n/.test(subject)) issues.push(issue("SUBJECT_MULTILINE", "error", "The subject must be a single line.", { field: "subject" }));
  for (const [k, value] of Object.entries(input.providerMetadata ?? {})) {
    const def = ch.providerFields.find((f) => f.key === k);
    if (!def) issues.push(issue("INVALID_PROVIDER_FIELD", "error", `"${k}" isn't a setting for ${ch.label} templates.`, { field: "providerMetadata" }));
    else if (value && !new RegExp(def.pattern).test(value)) issues.push(issue("INVALID_PROVIDER_FIELD", "error", `${def.label.replace(/ \(optional\)$/, "")}: "${value}" isn't valid.`, { field: "providerMetadata" }));
  }
  const parsedSubject = subject ? parseTemplateText(subject, "subject") : { issues: [] as TemplateIssue[] };
  const parsedBody = parseTemplateText(input.body, "body");
  issues.push(...parsedSubject.issues, ...parsedBody.issues);
  const sample = renderWithSampleData({ subject: ch.subject === "required" ? subject : null, body: input.body });
  issues.push(...checkRenderedLengths(input.channelType, sample, "sample"));
  const errors = issues.filter((x) => x.severity === "error");
  const warnings = issues.filter((x) => x.severity === "warning");
  return { valid: errors.length === 0, errors, warnings, variables: extractVariables(subject, input.body), ...(ch.smsSegments ? { sms: smsInfo(sample.body) } : {}) };
}

/** Inserts "{{key}}" at a caret position — used by the variable picker. */
export function insertVariable(text: string, key: string, selectionStart: number, selectionEnd = selectionStart): { text: string; caret: number } {
  const token = `{{${key}}}`;
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  return { text: text.slice(0, start) + token + text.slice(end), caret: start + token.length };
}
