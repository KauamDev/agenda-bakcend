const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3001;
const PUBLIC_DIR = __dirname;
const MAX_BODY_SIZE = 512 * 1024; // 512KB
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_icUl2CKuj4OR@ep-round-star-be2z9ker-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require';

// =========================================================================
// CAMADA DE PERSISTÊNCIA DEDICADA: NEON POSTGRESQL (NUNCA PERDE DADOS)
// =========================================================================
let pgPool = null;
let sqliteDb = null;
let isPostgres = false;

if (DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    isPostgres = true;
    console.log('🐘 Conectado ao Neon PostgreSQL (Persistência Permanente 24/7 Ativa)');

    // Inicializa schema no PostgreSQL
    pgPool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        senha_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(64) NOT NULL,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessoes (
        token VARCHAR(64) PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        expira_em BIGINT NOT NULL,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tokens_recuperacao (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        codigo VARCHAR(10) NOT NULL,
        expira_em BIGINT NOT NULL,
        usado INTEGER DEFAULT 0,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS compromissos (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        titulo VARCHAR(100) NOT NULL,
        descricao TEXT DEFAULT '',
        data VARCHAR(10) NOT NULL,
        horario VARCHAR(10) DEFAULT '',
        categoria VARCHAR(50) DEFAULT 'Geral',
        concluido INTEGER DEFAULT 0,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_pg_comp_user ON compromissos(usuario_id, data);
      CREATE INDEX IF NOT EXISTS idx_pg_sess_token ON sessoes(token);
    `).catch(err => console.error('Erro ao verificar schema Postgres:', err));
  } catch (err) {
    console.warn('Driver pg não encontrado. Recorrendo a SQLite local...', err.message);
  }
}

if (!isPostgres) {
  const { DatabaseSync } = require('node:sqlite');
  const DB_FILE = path.join(__dirname, 'agenda.db');
  sqliteDb = new DatabaseSync(DB_FILE);
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
  sqliteDb.exec('PRAGMA synchronous = NORMAL;');
  sqliteDb.exec('PRAGMA busy_timeout = 10000;');
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
  console.log('📁 Modo SQLite local ativo');
}

// =========================================================================
// MÉTODOS ABSTRATOS DO BANCO DE DADOS (SUPORTA POSTGRES E SQLITE)
// =========================================================================
const DB = {
  async getUsuarioByEmail(email) {
    const clean = email.trim().toLowerCase();
    if (isPostgres) {
      const res = await pgPool.query('SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)', [clean]);
      return res.rows[0] || null;
    } else {
      return sqliteDb.prepare('SELECT * FROM usuarios WHERE email = ? COLLATE NOCASE').get(clean) || null;
    }
  },

  async createUsuario(nome, email, hash, salt) {
    const clean = email.trim().toLowerCase();
    if (isPostgres) {
      const res = await pgPool.query(
        'INSERT INTO usuarios (nome, email, senha_hash, salt) VALUES ($1, $2, $3, $4) RETURNING id, nome, email',
        [nome.trim(), clean, hash, salt]
      );
      return res.rows[0];
    } else {
      const stmt = sqliteDb.prepare('INSERT INTO usuarios (nome, email, senha_hash, salt) VALUES (?, ?, ?, ?)');
      const r = stmt.run(nome.trim(), clean, hash, salt);
      return { id: r.lastInsertRowid, nome: nome.trim(), email: clean };
    }
  },

  async getSession(token, now) {
    if (isPostgres) {
      const res = await pgPool.query(`
        SELECT s.token, u.id, u.nome, u.email 
        FROM sessoes s
        JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token = $1 AND s.expira_em > $2
      `, [token, now]);
      return res.rows[0] || null;
    } else {
      const stmt = sqliteDb.prepare(`
        SELECT s.token, u.id, u.nome, u.email 
        FROM sessoes s
        JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token = ? AND s.expira_em > ?
      `);
      return stmt.get(token, now) || null;
    }
  },

  async createSession(token, userId, expiraEm) {
    if (isPostgres) {
      await pgPool.query('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES ($1, $2, $3)', [token, userId, expiraEm]);
    } else {
      sqliteDb.prepare('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?, ?, ?)').run(token, userId, expiraEm);
    }
  },

  async deleteSession(token) {
    if (isPostgres) {
      await pgPool.query('DELETE FROM sessoes WHERE token = $1', [token]);
    } else {
      sqliteDb.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
    }
  },

  async createRecoveryToken(userId, codigo, expiraEm) {
    if (isPostgres) {
      await pgPool.query('UPDATE tokens_recuperacao SET usado = 1 WHERE usuario_id = $1', [userId]);
      await pgPool.query('INSERT INTO tokens_recuperacao (usuario_id, codigo, expira_em) VALUES ($1, $2, $3)', [userId, codigo, expiraEm]);
    } else {
      sqliteDb.prepare('UPDATE tokens_recuperacao SET usado = 1 WHERE usuario_id = ?').run(userId);
      sqliteDb.prepare('INSERT INTO tokens_recuperacao (usuario_id, codigo, expira_em) VALUES (?, ?, ?)').run(userId, codigo, expiraEm);
    }
  },

  async getValidRecoveryToken(userId, codigo, now) {
    if (isPostgres) {
      const res = await pgPool.query(`
        SELECT id FROM tokens_recuperacao 
        WHERE usuario_id = $1 AND codigo = $2 AND usado = 0 AND expira_em > $3
      `, [userId, codigo, now]);
      return res.rows[0] || null;
    } else {
      return sqliteDb.prepare(`
        SELECT id FROM tokens_recuperacao 
        WHERE usuario_id = ? AND codigo = ? AND usado = 0 AND expira_em > ?
      `).get(userId, codigo, now) || null;
    }
  },

  async updatePasswordAndRevoke(userId, hash, salt, tokenId) {
    if (isPostgres) {
      await pgPool.query('UPDATE usuarios SET senha_hash = $1, salt = $2 WHERE id = $3', [hash, salt, userId]);
      await pgPool.query('UPDATE tokens_recuperacao SET usado = 1 WHERE id = $1', [tokenId]);
      await pgPool.query('DELETE FROM sessoes WHERE usuario_id = $1', [userId]);
    } else {
      sqliteDb.prepare('UPDATE usuarios SET senha_hash = ?, salt = ? WHERE id = ?').run(hash, salt, userId);
      sqliteDb.prepare('UPDATE tokens_recuperacao SET usado = 1 WHERE id = ?').run(tokenId);
      sqliteDb.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(userId);
    }
  },

  async getCompromissos(userId) {
    if (isPostgres) {
      const res = await pgPool.query(`
        SELECT id, titulo, descricao, data, horario, categoria, concluido, criado_em 
        FROM compromissos 
        WHERE usuario_id = $1 
        ORDER BY data ASC, horario ASC, id DESC
      `, [userId]);
      return res.rows;
    } else {
      return sqliteDb.prepare(`
        SELECT id, titulo, descricao, data, horario, categoria, concluido, criado_em 
        FROM compromissos 
        WHERE usuario_id = ? 
        ORDER BY data ASC, horario ASC, id DESC
      `).all(userId);
    }
  },

  async checkConflict(userId, data, horario) {
    if (!horario) return null;
    if (isPostgres) {
      const res = await pgPool.query(`
        SELECT id, titulo FROM compromissos 
        WHERE usuario_id = $1 AND data = $2 AND horario = $3 AND concluido = 0
      `, [userId, data, horario]);
      return res.rows[0] || null;
    } else {
      return sqliteDb.prepare(`
        SELECT id, titulo FROM compromissos 
        WHERE usuario_id = ? AND data = ? AND horario = ? AND concluido = 0
      `).get(userId, data, horario) || null;
    }
  },

  async createCompromisso(userId, titulo, descricao, data, horario, categoria) {
    if (isPostgres) {
      const res = await pgPool.query(`
        INSERT INTO compromissos (usuario_id, titulo, descricao, data, horario, categoria, concluido)
        VALUES ($1, $2, $3, $4, $5, $6, 0)
        RETURNING *
      `, [userId, titulo, descricao, data, horario, categoria]);
      return res.rows[0];
    } else {
      const stmt = sqliteDb.prepare(`
        INSERT INTO compromissos (usuario_id, titulo, descricao, data, horario, categoria, concluido)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `);
      const r = stmt.run(userId, titulo, descricao, data, horario, categoria);
      return sqliteDb.prepare('SELECT * FROM compromissos WHERE id = ? AND usuario_id = ?').get(r.lastInsertRowid, userId);
    }
  },

  async updateStatus(id, userId, concluido) {
    const val = concluido ? 1 : 0;
    if (isPostgres) {
      const res = await pgPool.query(
        'UPDATE compromissos SET concluido = $1 WHERE id = $2 AND usuario_id = $3 RETURNING *',
        [val, id, userId]
      );
      return res.rows[0] || null;
    } else {
      sqliteDb.prepare('UPDATE compromissos SET concluido = ? WHERE id = ? AND usuario_id = ?').run(val, id, userId);
      return sqliteDb.prepare('SELECT * FROM compromissos WHERE id = ? AND usuario_id = ?').get(id, userId);
    }
  },

  async deleteCompromisso(id, userId) {
    if (isPostgres) {
      const res = await pgPool.query('DELETE FROM compromissos WHERE id = $1 AND usuario_id = $2', [id, userId]);
      return res.rowCount > 0;
    } else {
      const r = sqliteDb.prepare('DELETE FROM compromissos WHERE id = ? AND usuario_id = ?').run(id, userId);
      return r.changes > 0;
    }
  }
};

const ALLOWED_CATEGORIES = ['Trabalho', 'Pessoal', 'Finanças', 'Lembrete', 'Urgente', 'Geral'];

// =========================================================================
// ANTI-FORÇA BRUTA (RATE LIMITING EM MEMÓRIA)
// =========================================================================
const loginAttempts = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000;

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
}

function checkRateLimit(key) {
  const record = loginAttempts.get(key);
  if (!record) return { blocked: false };
  if (record.blockUntil && Date.now() < record.blockUntil) {
    const minsLeft = Math.ceil((record.blockUntil - Date.now()) / 60000);
    return { blocked: true, minsLeft };
  }
  if (record.blockUntil && Date.now() >= record.blockUntil) {
    loginAttempts.delete(key);
  }
  return { blocked: false };
}

function recordFailedAttempt(key) {
  const record = loginAttempts.get(key) || { count: 0, blockUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.blockUntil = Date.now() + BLOCK_DURATION_MS;
  }
  loginAttempts.set(key, record);
}

function resetFailedAttempts(key) {
  loginAttempts.delete(key);
}

// =========================================================================
// CRIPTOGRAFIA
// =========================================================================
function validarSenhaForte(senha) {
  if (typeof senha !== 'string') return false;
  return senha.length >= 8 &&
    /[A-Z]/.test(senha) &&
    /[a-z]/.test(senha) &&
    /[0-9]/.test(senha) &&
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(senha);
}

function gerarHashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return { salt, hash };
}

function verificarSenha(senhaDigitada, salt, hashArmazenado) {
  try {
    const hashCalculado = crypto.scryptSync(senhaDigitada, salt, 64).toString('hex');
    const bufArmazenado = Buffer.from(hashArmazenado, 'hex');
    const bufCalculado = Buffer.from(hashCalculado, 'hex');
    if (bufArmazenado.length !== bufCalculado.length) return false;
    return crypto.timingSafeEqual(bufArmazenado, bufCalculado);
  } catch (err) {
    return false;
  }
}

// Middleware de autenticação
async function autenticarRequisicao(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  if (!token || token.length !== 64) return null;

  try {
    return await DB.getSession(token, Date.now());
  } catch (err) {
    return null;
  }
}

function setSecurityHeaders(res, origin) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self';"
  );

  const allowedOrigins = ['https://agendafarofa.netlify.app', 'https://farofateste.netlify.app'];
  if (origin && (allowedOrigins.includes(origin) || origin.startsWith('http://localhost:'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://agendafarofa.netlify.app');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJSON(res, status, data, origin) {
  setSecurityHeaders(res, origin);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
  });
  res.end(JSON.stringify(data));
}

function getHojeSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

async function enviarEmailRecuperacao(destinatario, codigo) {
  if (!RESEND_API_KEY) {
    console.log(`[RESEND] Sem chave configurada. Código gerado no servidor para [${destinatario}]: ${codigo}`);
    return { enviado: false, motivo: 'Sem chave RESEND_API_KEY' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Agenda Pessoal Segura <onboarding@resend.dev>',
        to: destinatario,
        subject: 'Código de Recuperação de Senha - Agenda Pessoal',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 28px; background: #0B0E14; color: #FFFFFF; border-radius: 12px; border: 1px solid #1E2538;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
              <div style="width: 36px; height: 36px; background: #3B82F6; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 20px; text-align: center; line-height: 36px;">📅</div>
              <h2 style="margin: 0; font-size: 20px; color: #FFFFFF;">AGENDA PESSOAL</h2>
            </div>
            <p style="font-size: 15px; color: #94A3B8; line-height: 1.5;">Você solicitou a recuperação de acesso à sua conta.</p>
            <p style="font-size: 14px; color: #CBD5E1; margin-top: 16px;">Seu código de verificação temporário é:</p>
            <div style="margin: 20px 0; padding: 16px; background: #151A26; border: 1px dashed #3B82F6; border-radius: 8px; text-align: center;">
              <span style="font-family: monospace; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #10B981;">${codigo}</span>
            </div>
            <p style="font-size: 13px; color: #64748B; line-height: 1.4;">
              ⏳ Este código expira em <strong>15 minutos</strong> e só pode ser usado uma única vez.<br>
              Se você não solicitou a redefinição de senha, ignore este e-mail.
            </p>
          </div>
        `
      })
    });
    return { enviado: res.ok };
  } catch (err) {
    console.error('Erro Resend:', err);
    return { enviado: false, erro: err.message };
  }
}

// =========================================================================
// SERVIDOR HTTP COM ROTAS ASSÍNCRONAS
// =========================================================================
const server = http.createServer(async (req, res) => {
  const origin = req.headers['origin'];
  setSecurityHeaders(res, origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const clientIP = getClientIP(req);
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // 1. POST /api/auth/cadastro
  if (method === 'POST' && pathname === '/api/auth/cadastro') {
    let body = '';
    let bodyLength = 0;
    req.on('data', chunk => {
      bodyLength += chunk.length;
      if (bodyLength > MAX_BODY_SIZE) req.destroy();
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const { nome, email, senha } = JSON.parse(body);

        if (!nome || typeof nome !== 'string') return sendJSON(res, 400, { error: 'Nome é obrigatório.' }, origin);
        const nomeTrim = nome.trim();
        if (nomeTrim.length < 2 || nomeTrim.length > 60) return sendJSON(res, 400, { error: 'O nome deve ter entre 2 e 60 caracteres.' }, origin);
        if (!/^[A-Za-zÀ-ÖØ-öø-ÿ\s'-]+$/.test(nomeTrim)) {
          return sendJSON(res, 400, { error: 'O nome deve conter apenas letras e espaços (sem números ou símbolos).' }, origin);
        }

        if (!email || typeof email !== 'string') return sendJSON(res, 400, { error: 'E-mail é obrigatório.' }, origin);
        const emailClean = email.trim().toLowerCase();
        if (emailClean.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
          return sendJSON(res, 400, { error: 'Informe um endereço de e-mail válido.' }, origin);
        }

        if (!validarSenhaForte(senha)) {
          return sendJSON(res, 400, { 
            error: 'Senha fraca. Mínimo 8 caracteres com maiúscula, minúscula, número e símbolo especial (!@#$).' 
          }, origin);
        }

        const existe = await DB.getUsuarioByEmail(emailClean);
        if (existe) {
          return sendJSON(res, 409, { error: 'Este e-mail já está cadastrado. Faça login na sua conta.' }, origin);
        }

        const { salt, hash } = gerarHashSenha(senha);
        const novoUsuario = await DB.createUsuario(nomeTrim, emailClean, hash, salt);

        const token = crypto.randomBytes(32).toString('hex');
        const expiraEm = Date.now() + (7 * 24 * 60 * 60 * 1000);
        await DB.createSession(token, novoUsuario.id, expiraEm);

        return sendJSON(res, 201, {
          success: true,
          token,
          usuario: { id: novoUsuario.id, nome: novoUsuario.nome, email: novoUsuario.email }
        }, origin);
      } catch (err) {
        return sendJSON(res, 400, { error: 'Requisição inválida.' }, origin);
      }
    });
    return;
  }

  // 2. POST /api/auth/login
  if (method === 'POST' && pathname === '/api/auth/login') {
    let body = '';
    let bodyLength = 0;
    req.on('data', chunk => {
      bodyLength += chunk.length;
      if (bodyLength > MAX_BODY_SIZE) req.destroy();
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const { email, senha } = JSON.parse(body);
        const emailClean = (email || '').trim().toLowerCase();

        const rateCheckIP = checkRateLimit(`ip_${clientIP}`);
        if (rateCheckIP.blocked) {
          return sendJSON(res, 429, { 
            error: `Muitas tentativas incorretas. Por segurança, tente novamente em ${rateCheckIP.minsLeft} minuto(s).` 
          }, origin);
        }
        if (emailClean) {
          const rateCheckEmail = checkRateLimit(`email_${emailClean}`);
          if (rateCheckEmail.blocked) {
            return sendJSON(res, 429, { 
              error: `Conta temporariamente bloqueada por excesso de tentativas. Tente em ${rateCheckEmail.minsLeft} minuto(s).` 
            }, origin);
          }
        }

        if (!emailClean || !senha || typeof senha !== 'string') {
          return sendJSON(res, 400, { error: 'Informe e-mail e senha.' }, origin);
        }

        const usuario = await DB.getUsuarioByEmail(emailClean);
        if (!usuario || !verificarSenha(senha, usuario.salt, usuario.senha_hash)) {
          recordFailedAttempt(`ip_${clientIP}`);
          recordFailedAttempt(`email_${emailClean}`);
          return sendJSON(res, 401, { error: 'E-mail ou senha incorretos.' }, origin);
        }

        resetFailedAttempts(`ip_${clientIP}`);
        resetFailedAttempts(`email_${emailClean}`);

        const token = crypto.randomBytes(32).toString('hex');
        const expiraEm = Date.now() + (7 * 24 * 60 * 60 * 1000);
        await DB.createSession(token, usuario.id, expiraEm);

        return sendJSON(res, 200, {
          success: true,
          token,
          usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email }
        }, origin);
      } catch (err) {
        return sendJSON(res, 400, { error: 'Requisição inválida.' }, origin);
      }
    });
    return;
  }

  // 3. POST /api/auth/recuperar-senha
  if (method === 'POST' && pathname === '/api/auth/recuperar-senha') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body);
        const emailClean = (email || '').trim().toLowerCase();
        if (!emailClean) return sendJSON(res, 400, { error: 'Informe o e-mail.' }, origin);

        const usuario = await DB.getUsuarioByEmail(emailClean);
        if (usuario) {
          const codigo = crypto.randomInt(100000, 999999).toString();
          const expiraEm = Date.now() + (15 * 60 * 1000);

          await DB.createRecoveryToken(usuario.id, codigo, expiraEm);
          console.log(`🔑 CÓDIGO DE RECUPERAÇÃO GERADO PARA [${emailClean}]: ${codigo}`);

          enviarEmailRecuperacao(emailClean, codigo).catch(console.error);

          return sendJSON(res, 200, { 
            success: true, 
            message: 'Código de recuperação enviado para seu e-mail! Verifique sua caixa de entrada e spam.'
          }, origin);
        }

        return sendJSON(res, 200, { 
          success: true, 
          message: 'Se o e-mail estiver cadastrado, um código de verificação foi enviado. Verifique sua caixa de entrada e spam.' 
        }, origin);
      } catch (e) {
        return sendJSON(res, 400, { error: 'Requisição inválida.' }, origin);
      }
    });
    return;
  }

  // 4. POST /api/auth/redefinir-senha
  if (method === 'POST' && pathname === '/api/auth/redefinir-senha') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { email, codigo, novaSenha } = JSON.parse(body);
        const emailClean = (email || '').trim().toLowerCase();
        const codigoClean = (codigo || '').trim();

        if (!emailClean || !codigoClean || !novaSenha) {
          return sendJSON(res, 400, { error: 'Informe e-mail, código e nova senha.' }, origin);
        }

        if (!validarSenhaForte(novaSenha)) {
          return sendJSON(res, 400, { 
            error: 'A nova senha deve ter no mínimo 8 caracteres com maiúscula, minúscula, número e símbolo especial.' 
          }, origin);
        }

        const usuario = await DB.getUsuarioByEmail(emailClean);
        if (!usuario) return sendJSON(res, 400, { error: 'Código inválido ou expirado.' }, origin);

        const recup = await DB.getValidRecoveryToken(usuario.id, codigoClean, Date.now());
        if (!recup) return sendJSON(res, 400, { error: 'Código de recuperação inválido ou expirado.' }, origin);

        const { salt, hash } = gerarHashSenha(novaSenha);
        await DB.updatePasswordAndRevoke(usuario.id, hash, salt, recup.id);

        return sendJSON(res, 200, { 
          success: true, 
          message: 'Senha redefinida com sucesso! Todas as sessões anteriores foram encerradas por segurança. Faça login.' 
        }, origin);
      } catch (e) {
        return sendJSON(res, 400, { error: 'Erro ao processar redefinição.' }, origin);
      }
    });
    return;
  }

  // 5. GET /api/auth/me
  if (method === 'GET' && pathname === '/api/auth/me') {
    const session = await autenticarRequisicao(req);
    if (!session) return sendJSON(res, 401, { error: 'Sessão inválida ou expirada.' }, origin);
    return sendJSON(res, 200, {
      usuario: { id: session.id, nome: session.nome, email: session.email }
    }, origin);
  }

  // 6. POST /api/auth/logout
  if (method === 'POST' && pathname === '/api/auth/logout') {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      await DB.deleteSession(token);
    }
    return sendJSON(res, 200, { success: true }, origin);
  }

  // 7. GET /api/compromissos
  if (method === 'GET' && pathname === '/api/compromissos') {
    const session = await autenticarRequisicao(req);
    if (!session) return sendJSON(res, 401, { error: 'Faça login para ver sua agenda.' }, origin);

    try {
      const items = await DB.getCompromissos(session.id);
      return sendJSON(res, 200, items, origin);
    } catch (err) {
      return sendJSON(res, 500, { error: 'Erro ao consultar banco de dados.' }, origin);
    }
  }

  // 8. POST /api/compromissos
  if (method === 'POST' && pathname === '/api/compromissos') {
    const session = await autenticarRequisicao(req);
    if (!session) return sendJSON(res, 401, { error: 'Faça login.' }, origin);

    let body = '';
    let bodyLength = 0;
    req.on('data', chunk => {
      bodyLength += chunk.length;
      if (bodyLength > MAX_BODY_SIZE) req.destroy();
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);

        if (!data.titulo || typeof data.titulo !== 'string' || data.titulo.trim().length === 0) {
          return sendJSON(res, 400, { error: 'Título é obrigatório.' }, origin);
        }
        const tituloClean = data.titulo.trim();
        if (tituloClean.length > 100) return sendJSON(res, 400, { error: 'Título não pode exceder 100 caracteres.' }, origin);

        if (!data.data || typeof data.data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.data)) {
          return sendJSON(res, 400, { error: 'Data em formato inválido. Use AAAA-MM-DD.' }, origin);
        }

        const hojeSP = getHojeSaoPaulo();
        if (data.data < hojeSP) {
          return sendJSON(res, 400, { error: 'Não é permitido criar compromissos em datas no passado.' }, origin);
        }

        let horarioClean = '';
        if (data.horario && typeof data.horario === 'string' && data.horario.trim() !== '') {
          horarioClean = data.horario.trim();
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horarioClean)) {
            return sendJSON(res, 400, { error: 'Horário em formato inválido. Use HH:MM.' }, origin);
          }

          const conflito = await DB.checkConflict(session.id, data.data, horarioClean);
          if (conflito) {
            return sendJSON(res, 409, { 
              error: `Você já possui o compromisso "${conflito.titulo}" agendado para às ${horarioClean}.` 
            }, origin);
          }
        }

        const descricao = typeof data.descricao === 'string' ? data.descricao.slice(0, 1000).trim() : '';
        const categoria = ALLOWED_CATEGORIES.includes(data.categoria) ? data.categoria : 'Geral';

        const newItem = await DB.createCompromisso(session.id, tituloClean, descricao, data.data, horarioClean, categoria);
        return sendJSON(res, 201, newItem, origin);
      } catch (err) {
        return sendJSON(res, 400, { error: 'Dados inválidos.' }, origin);
      }
    });
    return;
  }

  // 9. PUT /api/compromissos/:id
  if (method === 'PUT' && pathname.startsWith('/api/compromissos/')) {
    const session = await autenticarRequisicao(req);
    if (!session) return sendJSON(res, 401, { error: 'Faça login.' }, origin);

    const id = parseInt(pathname.split('/').pop(), 10);
    if (isNaN(id) || id <= 0) return sendJSON(res, 400, { error: 'ID inválido.' }, origin);

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        if (typeof data.concluido !== 'undefined') {
          const updated = await DB.updateStatus(id, session.id, data.concluido);
          if (!updated) return sendJSON(res, 404, { error: 'Compromisso não encontrado no seu usuário.' }, origin);
          return sendJSON(res, 200, updated, origin);
        }
        return sendJSON(res, 400, { error: 'Dados inválidos.' }, origin);
      } catch (err) {
        return sendJSON(res, 400, { error: 'Dados inválidos.' }, origin);
      }
    });
    return;
  }

  // 10. DELETE /api/compromissos/:id
  if (method === 'DELETE' && pathname.startsWith('/api/compromissos/')) {
    const session = await autenticarRequisicao(req);
    if (!session) return sendJSON(res, 401, { error: 'Faça login.' }, origin);

    const id = parseInt(pathname.split('/').pop(), 10);
    if (isNaN(id) || id <= 0) return sendJSON(res, 400, { error: 'ID inválido.' }, origin);

    try {
      const deleted = await DB.deleteCompromisso(id, session.id);
      if (!deleted) return sendJSON(res, 404, { error: 'Compromisso não encontrado ou sem permissão.' }, origin);
      return sendJSON(res, 200, { success: true }, origin);
    } catch (err) {
      return sendJSON(res, 500, { error: 'Erro ao deletar.' }, origin);
    }
  }

  // SERVIR ARQUIVOS ESTÁTICOS
  const FORBIDDEN_EXTENSIONS = ['.db', '.sqlite', '.sqlite3', '.env', '.json', '.bak', '.log'];
  const ext = path.extname(pathname).toLowerCase();

  if (FORBIDDEN_EXTENSIONS.includes(ext) || pathname.includes('.db') || pathname.includes('agenda.db')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Acesso Proibido');
  }

  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  let normalizedPath = path.normalize(filePath);

  if (!normalizedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Acesso Negado');
  }

  fs.stat(normalizedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      normalizedPath = path.join(PUBLIC_DIR, 'index.html');
    }

    const fileExt = path.extname(normalizedPath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png'
    };

    const contentType = mimeTypes[fileExt] || 'application/octet-stream';

    fs.readFile(normalizedPath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        return res.end('Erro interno');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor Agenda ativo na porta ${PORT} [Motor: ${isPostgres ? 'Neon Postgres' : 'SQLite'}]`);
});
