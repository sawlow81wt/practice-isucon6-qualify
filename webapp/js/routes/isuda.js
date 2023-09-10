'use strict';
const router = require('koa-router')();
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const axios = require('axios');
const ejs = require('ejs');

const NodeCache = require('node-cache');
const nodeCache = new NodeCache({ stdTTL: 60 * 60 * 24 });

let _config;
const config = (key) => {
  if (!_config) {
    _config = {
      dsn: process.env.ISUDA_DSN || 'dbi:mysql:db=isuda',
      dbHost: process.env.ISUDA_DB_HOST || 'localhost',
      dbPort: process.env.ISUDA_DB_PORT || 3306,
      dbName: process.env.ISUDA_DB_NAME || 'isuda',
      dbUser: process.env.ISUDA_DB_USER || 'root',
      dbPassword: process.env.ISUDA_DB_PASSWORD || '',
      webOrigin: process.env.WEB_ORIGIN || 'http://localhost',
      isutarOrigin: process.env.ISUTAR_ORIGIN || 'http://localhost:5001',
      isupamOrigin: process.env.ISUPAM_ORIGIN || 'http://localhost:5050',
    };
  }
  if (!_config.hasOwnProperty(key)) {
    throw `config value of ${key} undefined`;
  }
  return _config[key];
};

const pool = mysql.createPool({
    host: config('dbHost'),
    port: config('dbPort'),
    user: config('dbUser'),
    password: config('dbPassword'),
    database: config('dbName'),
    connectionLimit: 100,
    charset: 'utf8mb4'
});

class Node {
    constructor(id) {
        this.id = id;
        this.child = new Map()
        this.failure = null
        this.pattern = null
    }

    has_next(char) {
        return this.child.has(char);
    }

    is_terminal() {
        return this.child.size === 0;
    }
}

class AhoCorasick {

    constructor(patterns) {
        this.states = [new Node(0)];
        this.output = [[]];
        this.make_goto(patterns);
        this.make_failure();
    }

    make_goto(patterns) {
        for (let i = 0; i < patterns.length; i++) {
            let current_state = this.states[0];
            for (let j = 0; j < patterns[i].length; j++) {
                const char = patterns[i][j];
                if (!current_state.has_next(char)) {
                    const new_state = new Node(this.states.length);
                    current_state.child.set(char, new_state);
                    this.states.push(new_state);
                }
                current_state = current_state.child.get(char);
            }

            current_state.pattern = String(patterns[i]) // 末尾のノードにパターンを追加;
        }
    }

    make_failure() {
        const queue = [ this.states[0] ];
        while (queue.length > 0) {
            const current_state = queue.shift();
            for (let [char, next_state] of current_state.child) {
                queue.push(next_state);
                if (current_state.id === 0) {
                    next_state.failure = this.states[0];
                } else {
                    let failure_state = current_state.failure;
                    while (this.goto(failure_state, char) === null) {
                        failure_state = failure_state.failure;
                    }
                    next_state.failure = this.goto(failure_state, char);
                }
            }
        }
    }

    goto(state, char) {
        if (state.has_next(char)) {
            return state.child.get(char);
        }
        if (state.id === 0) {
            return state;
        }
        return null
    }


    match(query) {
        const result = [];
        let current_state = this.states[0] // root node

        for (let i = 0; i < query.length; i++) {
            // 遷移先がある場合は遷移
            while (this.goto(current_state, query[i]) === null) {
                if (current_state.pattern !== null) {
                    result.push([i - current_state.pattern.length, i, current_state.pattern]);
                    current_state = this.states[0];
                    break
                }
                current_state = current_state.failure;
            }
            current_state = this.goto(current_state, query[i]);
        }

        if (current_state.pattern !== null) {
            result.push([query.length - current_state.pattern.length, query.length, current_state.pattern]);
        }
        return result;
    }
}

// SEE ALSO: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
const RFC3986URIComponent = (str) => {
    const ret = nodeCache.get(str);
    if (ret) {
      return ret;
    }
    const encoded = encodeURIComponent(str).replace(/[!'()*]/g, (c) => {
          return '%' + c.charCodeAt(0).toString(16);
    });
    nodeCache.set(str, encoded);
    return encoded;
};

const dbh = async (ctx) => {
  if (ctx.dbh) {
    return ctx.dbh;
  }

  ctx.dbh = await pool.getConnection();
  // await ctx.dbh.query("SET SESSION sql_mode='TRADITIONAL,NO_AUTO_VALUE_ON_ZERO,ONLY_FULL_GROUP_BY'");
  await ctx.dbh.query("SET NAMES utf8mb4");

  return ctx.dbh;
};

const setName = async (ctx) => {
  ctx.state = {};
  ctx.state.user_name = ctx.session.userName;
  return true;
};

const authenticate = (ctx) => {
  if (ctx.session.userId == null) {
    ctx.status = 403;
    return false;
  }
  return true;
};

router.use(async (ctx, next) => {
  await next();
  if (ctx.dbh) {
    pool.releaseConnection(ctx.dbh);
    ctx.dbh = null;
  }
});

router.get('initialize', async (ctx, next) => {
  const db = await dbh(ctx);
  await db.query('DELETE FROM entry WHERE id > 7101');
  const origin = config('isutarOrigin');
  const res = await axios.get(`${origin}/initialize`);
  ctx.body = {
    result: 'ok',
  };
});

router.get('', async (ctx, next) => {
  if (!await setName(ctx)) {
    return;
  }
  const perPage = 10;
  const page = parseInt(ctx.query.page) || 1;

  const db = await dbh(ctx);
  const entries = (await db.query('SELECT * FROM entry ORDER BY updated_at DESC LIMIT ? OFFSET ?', [perPage, perPage * (page - 1)]))[0];
  const aho_corasick = await make_aho_corasick(ctx);
  const load_stars = [];
  for (let entry of entries) {
    load_stars.push(loadStars(ctx, entry.keyword))
  }
  const entry_stars = new Map;
  (await Promise.all(load_stars)).forEach((stars, i) => {
    entry_stars.set(entries[i].keyword, stars);
  });

  for (let entry of entries) {
    entry.html = htmlify(ctx, entry.description, aho_corasick);
    entry.stars = entry_stars.get(entry.keyword);
  }
  
  const totalEntries = await db.query('SELECT COUNT(*) AS `count` FROM entry');
  const lastPage = Math.ceil(totalEntries[0].count / perPage);
  const pages = [];
  for (let i = Math.max(1, page - 5); i <= Math.min(lastPage, page + 5); i++) {
    pages.push(i);
  }

  ctx.state.entries = entries;
  ctx.state.page = page;
  ctx.state.lastPage = lastPage;
  ctx.state.pages = pages;

  await ctx.render('index', {
  });
});

router.get('robots.txt', async (ctx, next) => {
  ctx.status = 404;
});

router.post('keyword', async (ctx, next) => {
  if (!await setName(ctx)) {
    return;
  }
  if (!authenticate(ctx)) {
    return;
  }
  const keyword = ctx.request.body.keyword || '';
  if (keyword.length === 0) {
    ctx.status = 400;
    ctx.body = "'keyword' required";
  }
  const userId = ctx.session.userId;
  const description = ctx.request.body.description;

  if (await isSpamContents(description) || await isSpamContents(keyword)) {
    ctx.status = 400;
    ctx.body = 'SPAM!';
    return;
  }

  const db = await dbh(ctx);
  await db.query(
    'INSERT INTO entry (author_id, keyword, keyword_length, description, created_at, updated_at) ' +
    'VALUES (?, ?, CHARACTER_LENGTH(keyword), ?, NOW(), NOW()) ' +
    'ON DUPLICATE KEY UPDATE ' +
    'author_id = ?, keyword = ?, keyword_length = CHARACTER_LENGTH(keyword), description = ?, updated_at = NOW()',
    [
      userId, keyword, description, userId, keyword, description
    ]);
  await purge_keywords_cache(ctx);
  await ctx.redirect('/');

});

router.get('register', async (ctx, next) => {
  if (!await setName(ctx)) {
    return;
  }
  ctx.state.action = 'register';
  await ctx.render('authenticate', {
  });
});

router.post('register', async (ctx, next) => {
  const name = ctx.request.body.name;
  const pw   = ctx.request.body.password;
  if (name === '' || pw === '') {
    ctx.status = 400;
    return;
  }
  const userId = await register(await dbh(ctx), name, pw);
  ctx.session.userId = userId;
  await ctx.redirect('/');
});

const register = async (db, user, pass) => {
  const salt = await randomString(10);
  const sha1 = crypto.createHash('sha1');
  sha1.update(salt + pass);
  await db.query('INSERT INTO user (name, salt, password, created_at) VALUES (?, ?, ?, NOW())', [user, salt, sha1.digest('hex')]);
  const row = await db.query("SELECT LAST_INSERT_ID() as lastInsertId ");
  return row[0].lastInsertId;
};

const randomString = (size) => {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(size, (err, buf) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(buf.toString('hex'));
    });
  });
}

router.get('login', async (ctx, next) => {
  if (!await setName(ctx)) {
    return;
  }
  ctx.state.action = 'login';
  await ctx.render('authenticate', {});
});

router.post('login', async (ctx, next) => {
  const name = ctx.request.body.name;
  const db = await dbh(ctx);
  const rows = (await db.query('SELECT * FROM user WHERE name = ?', [name]))[0];
  if (rows.length === 0) {
    ctx.status = 403;
    return;
  }
  const sha1 = crypto.createHash('sha1');
  sha1.update(rows[0].salt + ctx.request.body.password);
  const sha1Digest = sha1.digest('hex');
  if (rows[0].password != sha1Digest) {
    ctx.status = 403;
    return;
  }
  ctx.session.userId = rows[0].id;
  ctx.session.userName = rows[0].name;
  await ctx.redirect('/');
});

router.get('logout', async (ctx, next) => {
  ctx.session.userId = null;
  ctx.session.userName = null;
  await ctx.redirect('/');
});

router.get('keyword/:keyword', async (ctx, next) => {
  if (!await setName(ctx)) {
    return;
  }
  const keyword = ctx.params.keyword;
  if (!keyword) {
    ctx.status = 400;
    return;
  }
  const db = await dbh(ctx);
  const entries = (await db.query('SELECT * FROM entry WHERE keyword = ?', [keyword]))[0];
  if (entries.length === 0) {
    ctx.status = 404;
    return;
  }
  ctx.state.entry = entries[0];
  const aho_corasick = await make_aho_corasick(ctx);
  ctx.state.entry.html = htmlify(ctx, entries[0].description, aho_corasick);
  ctx.state.entry.stars = await loadStars(ctx, keyword);
  await ctx.render('keyword');
});

router.get('hasKeyword/:keyword', async (ctx, next) => {
  if (!await setName(ctx)) {
    return;
  }
  const keyword = ctx.params.keyword;
  if (!keyword) {
    ctx.status = 400;
    return;
  }
  const db = await dbh(ctx);
  const entries = (await db.query('SELECT * FROM entry WHERE keyword = ?', [keyword]))[0];
  if (entries.length === 0) {
    ctx.status = 404;
    return;
  }
  ctx.body = {
    result: 'ok',
  };
});

router.post('keyword/:keyword', async (ctx, next) => {
  if (!await setName(ctx)) {
    return;
  }
  if (!authenticate(ctx)) {
    return;
  }
  const keyword = ctx.params.keyword;
  if ( !keyword ) {
    ctx.status = 400;
    return;
  }
  const del = ctx.request.body.delete;
  if ( !ctx.request.body.delete ) {
    ctx.status = 400;
    return;
  }

  const db = await dbh(ctx);
  const entries = (await db.query('SELECT keywords FROM entry WHERE keyword = ?', [keyword]))[0];
  if (entries.length == 0) {
    ctx.status = 404;
    return;
  }

  await db.query('DELETE FROM entry WHERE keyword = ?', [keyword]);
  await purge_keywords_cache(ctx);
  await ctx.redirect('/');
});

const get_keywords = async (ctx) => {
  const cached_keywords = nodeCache.get('keywords');
  if (cached_keywords) {
    return cached_keywords;
  }

  const db = await dbh(ctx);
  const keywords = (await db.query('SELECT keyword FROM entry'))[0];
  nodeCache.set('keywords', keywords);
  return keywords;
};

const purge_keywords_cache = async (ctx) => {
  nodeCache.del('keywords');
};

const make_aho_corasick = async (ctx) => {
  const keywords = await get_keywords(ctx);
  const aho_corasick = new AhoCorasick(
    keywords.map((keyword) => escapeRegExp(keyword.keyword))
  );
  return aho_corasick;
};

const htmlify = (ctx, content, aho_corasick) => {
  if (content == null) {
    return '';
  }
  const results = aho_corasick.match(content);
  let result = '';
  let prev = 0;
  for (const [start, end, pattern] of results) {
    result += content.slice(prev, start);
    const url = `/keyword/${RFC3986URIComponent(pattern)}`;
    const link = `<a href=${url}>${ejs.escapeXML(pattern)}</a>`;
    result += link;
    prev = end;
  }
  result += content.slice(prev);
  result = result.replace(/\n/g, "<br />\n");
  return result;
};

const escapeRegExp  = (string) => {
    return string.replace(/([.*+?^=!:${}()|[\]\/\\])/g, "\\$1");
}

const escapeHtml = (string) => {
};

const loadStars = async (ctx, keyword) => {
  const origin = config('webOrigin');
  const url = `${origin}/stars`;
  const res = await axios.get(
    url,
    { 
      headers: { 'Content-Type': 'application/json' },
      params: { keyword: keyword }
    },
  );
  return res.data.stars;
};

const isSpamContents = async (content) => {
  const res = await axios.post(config('isupamOrigin'), `content=${encodeURIComponent(content)}`);
  return !res.data.valid;
};

module.exports = router;
