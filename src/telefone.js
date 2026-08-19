/**
 * Telefones no PDF aparecem como "(67) 99258-5419", "99902-3125" (sem DDD),
 * "(67) 9101-0513" (celular antigo, sem o nono digito) e ate fixos.
 * Aqui normalizamos para E.164 e sinalizamos o que precisa de conferencia.
 */

// O texto extraido do PDF pode vir como "99258-5419" ou "99258 - 5419".
const REGEX_TELEFONE = /(?:\((\d{2})\)\s*)?(\d{4,5})\s*-\s*(\d{4})/g;

export function extrairTelefones(texto, dddPadrao = '67', paisPadrao = '55') {
  const encontrados = [];
  for (const achado of texto.matchAll(REGEX_TELEFONE)) {
    const [, ddd, prefixo, sufixo] = achado;
    encontrados.push(normalizar({ ddd: ddd ?? dddPadrao, prefixo, sufixo, paisPadrao }));
  }
  // Remove repetidos preservando a ordem de aparicao.
  const vistos = new Set();
  return encontrados.filter((t) => {
    if (vistos.has(t.e164)) return false;
    vistos.add(t.e164);
    return true;
  });
}

function normalizar({ ddd, prefixo, sufixo, paisPadrao }) {
  const local = `${prefixo}${sufixo}`;
  const avisos = [];

  let ehCelular = local.length === 9 && local.startsWith('9');
  if (local.length === 8) {
    if (local.startsWith('9') || local.startsWith('8')) {
      // Celular sem o nono digito: o WhatsApp resolve o numero real na hora do
      // envio (getNumberId), entao mantemos como esta e avisamos.
      ehCelular = true;
      avisos.push('celular com 8 digitos (falta o nono digito)');
    } else {
      avisos.push('parece telefone fixo');
    }
  }
  if (local.length === 9 && !local.startsWith('9')) {
    avisos.push('numero de 9 digitos que nao comeca com 9');
  }

  return {
    e164: `${paisPadrao}${ddd}${local}`,
    formatado: `(${ddd}) ${prefixo}-${sufixo}`,
    ddd,
    local,
    ehCelular,
    avisos,
  };
}

export function formatarParaExibicao(e164) {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(e164 ?? '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? '');
}
