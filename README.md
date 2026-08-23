# Fashion ERP

Garment manufacturing ERP system (Next.js 16 + Prisma 7 + PostgreSQL). See [CLAUDE.md](./CLAUDE.md) for the full architecture, roadmap, and phase-by-phase build notes.

## Getting Started

1. Copy the env template and fill in real values:
   ```bash
   cp .env.example .env
   ```
2. Install dependencies and generate the Prisma client:
   ```bash
   npm install
   npx prisma generate
   ```
3. Run migrations and seed data:
   ```bash
   npx prisma migrate dev
   npx prisma db seed
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) with your browser.

### Default login (dev only)

| Field | Value |
|---|---|
| Email | `admin@indradhar.com` |
| Password | `ChangeMe123!` |

This is a **seeded dev-only credential** — change it immediately in any non-local environment. Never reuse this password outside your local dev database.

## Testing

```bash
npm test          # run the Vitest suite once
npm run test:watch
```

## Project Docs

- [CLAUDE.md](./CLAUDE.md) — architecture, database design, phased build order, and dated progress notes
- [ENTERPRISE_READINESS_ROADMAP.md](./ENTERPRISE_READINESS_ROADMAP.md) — CI/CD, security, testing, and observability roadmap
- [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) — senior-architecture critique that the roadmap above was written to address


admin@indradhar.com
ChangeMe123!