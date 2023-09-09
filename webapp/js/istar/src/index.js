import { Hono } from 'hono'
import { logger } from 'hono/logger'
import axios from 'axios'
import { Database } from "bun:sqlite";

const app = new Hono({
  port: process.env.ISUTAR_PORT || 5001,
})

app.use('*', logger())
app.use("*", async (ctx, next) => {
  await next();
  if (ctx.dbh) {
    await ctx.dbh.close();
    ctx.dbh = null;
  }
});

const RFC3986URIComponent = (str) => {
    return encodeURIComponent(str).replace(/[!'()*]/g, (c) => {
          return '%' + c.charCodeAt(0).toString(16);
    });
};

const dbh = async (ctx) => {
  if (ctx.dbh) {
    return ctx.dbh;
  }

  ctx.dbh = new Database("isutar.db");
  return ctx.dbh;
}

const initialize = async (ctx) => {
  const db = await dbh(ctx);
  await db.query('DROP TABLE IF EXISTS star');
  await db.query(`
    CREATE TABLE IF NOT EXISTS star (
      id INTGER PRIMARY KEY,
      keyword VARCHAR(255) NOT NULL,
      user_name VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL
    );
  `)
  await db.query(`
    DROP INDEX IF EXISTS keyword_idx;
    CREATE INDEX keyword_idx ON star (keyword);
  `);
  return ctx.json({
    result: 'ok',
  })
}

const getStars = async (ctx) => {
  const keyword = ctx.req.query("keyword");
  const db = await dbh(ctx);
  const query = await db.query(`SELECT keyword, user_name FROM star WHERE keyword = $keyword`);
  const stars = query.all({ $keyword: keyword });

  return ctx.json({
    stars,
  })
}

const postStars = async (ctx) => {
  const db = await dbh(ctx);
  const body = await ctx.req.parseBody();
  const keyword = ctx.req.query("keyword") || body.keyword;
  const user = ctx.req.query("user") || body.user;

  const origin = process.env.WEB_ORIGIN || 'http://localhost:5003';
  const url = `${origin}/hasKeyword/${RFC3986URIComponent(keyword)}`;
  try {
    const res = await axios.get(url);
  } catch (err) {
    return ctx.text("", 404)
  }

  const query = db.query(`INSERT INTO star (keyword, user_name, created_at) VALUES ($keyword, $user, "now")`);

  const insert = await db.transaction((velues) => {
    query.run(velues);
  })

  const _ = await insert({ $keyword: keyword, $user: user })

  return ctx.json({
    result: 'ok',
  });
}

app.get('/initialize', initialize)
app.get('/stars', getStars)
app.post('/stars', postStars)

export default app
