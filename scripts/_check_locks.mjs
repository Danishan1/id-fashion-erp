import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const res = await client.query(`
  select pid, state, wait_event_type, wait_event, query_start, now() - query_start as duration, left(query, 150) as query
  from pg_stat_activity
  where datname = current_database()
  order by query_start asc
`);
for (const row of res.rows) {
  console.log(JSON.stringify(row));
}
console.log("---locks---");
const locks = await client.query(`
  select l.pid, l.mode, l.granted, l.relation::regclass as relation
  from pg_locks l
  where l.relation is not null
  order by l.pid
`);
for (const row of locks.rows) {
  console.log(JSON.stringify(row));
}
await client.end();
