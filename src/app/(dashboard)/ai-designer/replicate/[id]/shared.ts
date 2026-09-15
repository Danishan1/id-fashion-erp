/** Small helpers shared by every Replicate Design step panel — kept local to this feature, not imported from the sibling AI Designer wizard (module isolation). */
export function imageUrl(attachmentId: string) {
  return `/api/v1/ai-designer/attachments/${attachmentId}/download?disposition=inline`;
}

export async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}
