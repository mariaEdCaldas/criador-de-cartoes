import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CAMINHOS } from './config.js';

/**
 * Login simples com cookie assinado. Nao guarda sessao em memoria: o proprio
 * cookie carrega o id do usuario e a validade, assinados com um segredo local.
 * Reiniciar o servidor nao derruba quem esta logado.
 */

const ARQUIVO_USUARIOS = path.join(CAMINHOS.dados, 'usuarios.json');
const ARQUIVO_SEGREDO = path.join(CAMINHOS.dados, 'segredo.txt');
const HORAS_DE_SESSAO = 12;
const NOME_DO_COOKIE = 'sessao';

function segredo() {
  if (!fs.existsSync(ARQUIVO_SEGREDO)) {
    fs.writeFileSync(ARQUIVO_SEGREDO, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(ARQUIVO_SEGREDO, 'utf8').trim();
}

function lerUsuarios() {
  if (!fs.existsSync(ARQUIVO_USUARIOS)) return [];
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_USUARIOS, 'utf8'));
  } catch {
    return [];
  }
}

function salvarUsuarios(usuarios) {
  fs.writeFileSync(ARQUIVO_USUARIOS, JSON.stringify(usuarios, null, 2) + '\n', { mode: 0o600 });
}

/** A senha nunca e guardada: fica so o hash scrypt com sal proprio. */
function calcularHash(senha, sal) {
  return crypto.scryptSync(String(senha), sal, 64).toString('hex');
}

function iguais(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function temUsuarios() {
  return lerUsuarios().length > 0;
}

export function listarUsuarios() {
  return lerUsuarios().map(({ id, email, admin, criadoEm }) => ({ id, email, admin, criadoEm }));
}

export function criarUsuario({ email, senha, admin = false }) {
  const normalizado = String(email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizado)) throw new Error('E-mail inválido.');
  if (String(senha ?? '').length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');

  const usuarios = lerUsuarios();
  if (usuarios.some((u) => u.email === normalizado)) throw new Error('Já existe um usuário com esse e-mail.');

  const sal = crypto.randomBytes(16).toString('hex');
  const usuario = {
    id: crypto.randomUUID(),
    email: normalizado,
    sal,
    hash: calcularHash(senha, sal),
    admin: Boolean(admin),
    criadoEm: new Date().toISOString(),
  };
  usuarios.push(usuario);
  salvarUsuarios(usuarios);
  return { id: usuario.id, email: usuario.email, admin: usuario.admin };
}

export function removerUsuario(id) {
  const usuarios = lerUsuarios();
  const alvo = usuarios.find((u) => u.id === id);
  if (!alvo) throw new Error('Usuário não encontrado.');
  if (alvo.admin && usuarios.filter((u) => u.admin).length === 1) {
    throw new Error('Este é o único administrador; não dá para removê-lo.');
  }
  salvarUsuarios(usuarios.filter((u) => u.id !== id));
  return { id: alvo.id, email: alvo.email };
}

export function trocarSenha(id, senhaAtual, senhaNova) {
  if (String(senhaNova ?? '').length < 8) throw new Error('A nova senha precisa ter pelo menos 8 caracteres.');
  const usuarios = lerUsuarios();
  const usuario = usuarios.find((u) => u.id === id);
  if (!usuario) throw new Error('Usuário não encontrado.');
  if (!iguais(calcularHash(senhaAtual, usuario.sal), usuario.hash)) {
    throw new Error('A senha atual está errada.');
  }
  usuario.sal = crypto.randomBytes(16).toString('hex');
  usuario.hash = calcularHash(senhaNova, usuario.sal);
  salvarUsuarios(usuarios);
  return true;
}

export function autenticar(email, senha) {
  const normalizado = String(email ?? '').trim().toLowerCase();
  const usuario = lerUsuarios().find((u) => u.email === normalizado);
  if (!usuario) return null;
  if (!iguais(calcularHash(senha, usuario.sal), usuario.hash)) return null;
  return usuario;
}

export function gerarToken(usuario) {
  const expiraEm = Date.now() + HORAS_DE_SESSAO * 3600 * 1000;
  const corpo = `${usuario.id}.${expiraEm}`;
  const assinatura = crypto.createHmac('sha256', segredo()).update(corpo).digest('hex');
  return `${corpo}.${assinatura}`;
}

function verificarToken(token) {
  const partes = String(token ?? '').split('.');
  if (partes.length !== 3) return null;
  const [id, expiraEm, assinatura] = partes;

  const esperada = crypto.createHmac('sha256', segredo()).update(`${id}.${expiraEm}`).digest('hex');
  if (!iguais(assinatura, esperada)) return null;
  if (!Number(expiraEm) || Number(expiraEm) < Date.now()) return null;

  return lerUsuarios().find((u) => u.id === id) ?? null;
}

function lerCookie(req, nome) {
  for (const parte of String(req.headers.cookie ?? '').split(';')) {
    const [chave, ...resto] = parte.trim().split('=');
    if (chave === nome) return decodeURIComponent(resto.join('='));
  }
  return null;
}

export function usuarioDaRequisicao(req) {
  return verificarToken(lerCookie(req, NOME_DO_COOKIE));
}

export function definirCookie(req, res, token) {
  const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', [
    `${NOME_DO_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${HORAS_DE_SESSAO * 3600}`,
    seguro ? 'Secure' : '',
  ].filter(Boolean).join('; '));
}

export function limparCookie(res) {
  res.setHeader('Set-Cookie', `${NOME_DO_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function exigirLogin(req, res, next) {
  const usuario = usuarioDaRequisicao(req);
  if (!usuario) return res.status(401).json({ erro: 'Sessão expirada. Faça login de novo.' });
  req.usuario = usuario;
  next();
}

export function exigirAdmin(req, res, next) {
  if (!req.usuario?.admin) {
    return res.status(403).json({ erro: 'Só o administrador pode fazer isso.' });
  }
  next();
}

/**
 * Bootstrap em servidor novo: sem nenhum usuario cadastrado, cria o admin a
 * partir de ADMIN_EMAIL / ADMIN_SENHA. Local, o usuario ja vem do arquivo.
 */
export function semearAdmin(aoRegistrar = console.log) {
  if (temUsuarios()) return;
  const email = process.env.ADMIN_EMAIL;
  const senha = process.env.ADMIN_SENHA;
  if (!email || !senha) {
    aoRegistrar('[login] NENHUM usuario cadastrado. Rode: node src/index.js usuario --email=... --senha=... --admin');
    return;
  }
  criarUsuario({ email, senha, admin: true });
  aoRegistrar(`[login] administrador ${email} criado a partir das variaveis de ambiente.`);
}
