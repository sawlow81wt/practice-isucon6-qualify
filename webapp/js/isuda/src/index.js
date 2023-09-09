import { Hono } from 'hono'
import { logger } from 'hono/logger'
import mysql from 'mysql2/promise'

const app = new Hono({
    port: process.env.ISUDA_PORT || 5003,
})

app.use('*', logger())
app.use("*", async (ctx, next) => {
  await next();
  if (ctx.dbh) {
    await ctx.dbh.end();
    ctx.dbh = null;
  }
});

let _config;
const config = (key) => {
  if (!_config) {
    _config = {
      dsn: process.env.ISUDA_DSN || 'dbi:mysql:db=isuda',
      dbHost: process.env.ISUDA_DB_HOST || 'localhost',
      dbPort: process.env.ISUDA_DB_PORT || 3306,
      dbName: process.env.ISUDA_DB_NAME || 'isuda',
      dbUser: process.env.ISUDA_DB_USER || 'root',
      dbPassword: process.env.ISUDA_DB_PASSWORD || 'isucon',
      isutarOrigin: process.env.ISUTAR_ORIGIN || 'http://localhost:5001',
      isupamOrigin: process.env.ISUPAM_ORIGIN || 'http://localhost:5050',
    };
  }
  if (!_config.hasOwnProperty(key)) {
    throw `config value of ${key} undefined`;
  }
  return _config[key];
};

// SEE ALSO: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
const RFC3986URIComponent = (str) => {
    return encodeURIComponent(str).replace(/[!'()*]/g, (c) => {
          return '%' + c.charCodeAt(0).toString(16);
    });
}


const dbh = async (ctx) => {
  if (ctx.dbh) {
    return ctx.dbh;
  }

  console.log("config", config('dsn'), config('dbHost'), config('dbPort'), config('dbUser'), config('dbPassword'), config('dbName'));

  ctx.dbh = await mysql.createConnection({
    host: config('dbHost'),
    port: config('dbPort'),
    user: config('dbUser'),
    password: config('dbPassword'),
    database: config('dbName'),
    charset: 'utf8mb4'
  });
  await ctx.dbh.query("SET SESSION sql_mode='TRADITIONAL,NO_AUTO_VALUE_ON_ZERO,ONLY_FULL_GROUP_BY'");
  await ctx.dbh.query("SET NAMES utf8mb4");

  return ctx.dbh;
};


const hasKeyword = async (ctx) => {
  const keyword = ctx.req.param("keyword");
  if (!keyword) {
    return ctx.body("no keyword", 404)
  }
  const db = await dbh(ctx);
  const entries = (await db.query('SELECT * FROM entry WHERE keyword = ?', [keyword]))[0];
  if (entries.length === 0) {
    return ctx.body("not found", 404)
  }
  return ctx.json({
    result: 'ok'
  })
}

app.get('/', (c) => c.text('Hello Hono!'))
app.get('hasKeyword/:keyword', hasKeyword)

export default app
