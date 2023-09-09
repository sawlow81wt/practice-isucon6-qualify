import { Hono } from 'hono'
import { logger } from 'hono/logger'
import mysql from 'mysql2/promise'
import axios from 'axios'

const app = new Hono({
  port: process.env.ISUTAR_PORT || 5001,
})

app.use('*', logger())
app.use("*", async (ctx, next) => {
  await next();
  if (ctx.dbh) {
    await ctx.dbh.end();
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

  ctx.dbh = await mysql.createConnection({
    host: process.env.ISUTAR_DB_HOST || 'localhost',
    port: process.env.ISUTAR_DB_PORT || 3307,
    user: process.env.ISUTAR_DB_USER || 'isucon',
    password: process.env.ISUTAR_DB_PASSWORD || 'isucon',
    database: 'isutar',
    connectionLimit: 1,
    charset: 'utf8mb4'
  });
  await ctx.dbh.query("SET SESSION sql_mode='TRADITIONAL,NO_AUTO_VALUE_ON_ZERO,ONLY_FULL_GROUP_BY'");
  await ctx.dbh.query("SET NAMES utf8mb4");

  return ctx.dbh;
}

const initialize = async (ctx) => {
  const db = await dbh(ctx);
  await db.query('TRUNCATE star');
  return ctx.json({
    result: 'ok',
  })
}

const getStars = async (ctx) => {
  const keyword = ctx.req.query("keyword");
  const db = await dbh(ctx);
  const stars = (await db.query('SELECT keyword, user_name FROM star WHERE keyword = ?', [keyword]))[0];

  return ctx.json({
    stars,
  })
}

const postStars = async (ctx) => {
  const db = await dbh(ctx);
  const body = await ctx.req.parseBody();
  const keyword = ctx.req.query("keyword") || body.keyword;
  const user = ctx.req.query("user") || body.user;

  const origin = process.env.ISUDA_ORIGIN || 'http://localhost:5000';
  const url = `${origin}/keyword/${RFC3986URIComponent(keyword)}`;
  try {
    const res = await axios.get(url);
  } catch (err) {
   
    return ctx.text("", 404)
  }

  await db.query('INSERT INTO star (keyword, user_name, created_at) VALUES (?, ?, NOW())', [
    keyword, user
  ]);

  return ctx.json({
    result: 'ok',
  });
}

app.get('/initialize', initialize)
app.get('/stars', getStars)
app.post('/stars', postStars)

export default app
