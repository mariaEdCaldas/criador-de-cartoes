import { EventEmitter } from 'node:events';
import pkg from 'whatsapp-web.js';
import { CAMINHOS } from './config.js';

const { Client, LocalAuth, MessageMedia } = pkg;

/**
 * Envolve o whatsapp-web.js num objeto com estado observavel, para o painel
 * mostrar QR code / "conectado" sem precisar olhar o terminal.
 */
class Whatsapp extends EventEmitter {
  constructor() {
    super();
    this.cliente = null;
    this.estado = 'desconectado'; // desconectado | iniciando | qr | conectado
    this.qr = null;
    this.erro = null;
    this.telefoneConectado = null;
  }

  async conectar() {
    if (this.cliente) return this;

    this.estado = 'iniciando';
    this.erro = null;
    this.emit('estado', this.resumo());

    this.cliente = new Client({
      authStrategy: new LocalAuth({ dataPath: CAMINHOS.sessaoWhatsapp }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    });

    this.cliente.on('qr', (qr) => {
      this.qr = qr;
      this.estado = 'qr';
      this.emit('estado', this.resumo());
    });

    this.cliente.on('ready', () => {
      this.qr = null;
      this.estado = 'conectado';
      this.telefoneConectado = this.cliente.info?.wid?.user ?? null;
      this.emit('estado', this.resumo());
    });

    this.cliente.on('auth_failure', (mensagem) => {
      this.erro = `Falha de autenticacao: ${mensagem}`;
      this.estado = 'desconectado';
      this.emit('estado', this.resumo());
    });

    this.cliente.on('disconnected', (motivo) => {
      this.estado = 'desconectado';
      this.erro = `Desconectado: ${motivo}`;
      this.cliente = null;
      this.emit('estado', this.resumo());
    });

    await this.cliente.initialize();
    return this;
  }

  async desconectar() {
    if (!this.cliente) return;
    await this.cliente.destroy().catch(() => {});
    this.cliente = null;
    this.estado = 'desconectado';
    this.qr = null;
    this.emit('estado', this.resumo());
  }

  resumo() {
    return {
      estado: this.estado,
      qr: this.qr,
      erro: this.erro,
      telefone: this.telefoneConectado,
    };
  }

  exigirConexao() {
    if (this.estado !== 'conectado' || !this.cliente) {
      throw new Error('WhatsApp nao esta conectado. Abra o painel e leia o QR code.');
    }
  }

  /**
   * Resolve o numero real no WhatsApp. E o que corrige celulares gravados sem
   * o nono digito e detecta numeros que nao tem conta.
   */
  async resolverNumero(e164) {
    this.exigirConexao();
    const id = await this.cliente.getNumberId(e164);
    return id ? id._serialized : null;
  }

  async enviarImagem(e164, caminhoOuBuffer, legenda) {
    this.exigirConexao();
    const destino = await this.resolverNumero(e164);
    if (!destino) throw new Error(`Numero sem WhatsApp: ${e164}`);

    const midia = Buffer.isBuffer(caminhoOuBuffer)
      ? new MessageMedia('image/png', caminhoOuBuffer.toString('base64'), 'cartao.png')
      : MessageMedia.fromFilePath(caminhoOuBuffer);

    await this.cliente.sendMessage(destino, midia, legenda ? { caption: legenda } : undefined);
    return destino;
  }
}

export const whatsapp = new Whatsapp();
