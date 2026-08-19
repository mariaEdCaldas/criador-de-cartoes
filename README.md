# Criador de Cartões de Aniversário

Você joga o PDF do mês, o sistema lê os aniversariantes, monta o cartão com o nome de
cada um (trocando **Amigo/Amiga** conforme o gênero) e envia pelo WhatsApp na data certa.

---

## Instalação (uma vez só)

```bash
npm install
```

A arte em branco do cartão já está em `assets/template.jpg`. Se você trocar a arte,
coloque o arquivo novo nessa pasta e aponte o caminho em `config.json` → `cartao.template`.

## Rotina de todo mês

1. **Abra o painel:**
   ```bash
   npm start
   ```
   e acesse <http://localhost:3000>.

2. **Aba "Importar PDF"** → envie o arquivo *Aniversariantes &lt;mês&gt;.pdf*.
   O sistema lê nome, telefone, data de nascimento e coordenador de cada pessoa e
   substitui a lista do mês anterior (uma cópia da lista antiga fica em `dados/`).

3. **Aba "Lista do mês"** → marque a caixa **só pendências** e resolva o que aparecer:
   nomes sem telefone, gênero incerto, número com formato estranho. Trocar o
   gênero de alguém ensina o sistema: no mês seguinte aquele nome já sai certo.

4. **Conectar o WhatsApp** (botão no topo). Aparece um QR code na aba
   *Configurações*. No celular: **WhatsApp → Aparelhos conectados → Conectar aparelho**.
   A sessão fica salva em `dados/sessao-whatsapp`; só precisa repetir se você
   desconectar o aparelho.

5. **Aba "Hoje"** → confira a fila do dia e clique em **Simular** (gera os cartões em
   `cartoes/` sem mandar nada) e depois em **Enviar agora**.

Para o envio acontecer sozinho todo dia, ligue **Envio automático** na aba
*Configurações* e escolha o horário. O computador precisa estar ligado com o
`npm start` rodando naquele horário.

## Ajustar o cartão

Aba **"Modelo do cartão"**: arraste os controles de posição e tamanho até o nome cair
no lugar certo e clique em *Salvar modelo*. Os valores são proporcionais à imagem, então
continuam valendo mesmo se você trocar a arte por outra de resolução diferente.

O texto usa dois marcadores: `{tratamento}` (vira Amigo/Amiga) e `{nome}`.
Padrão: `{tratamento} {nome}!` → **"Amiga Elaine!"**

## Pelo terminal (opcional)

```bash
npm run importar -- "Aniversariantes agosto.pdf"    # importa o PDF
npm run gerar -- --data=2026-08-20                  # gera os cartões do dia em cartoes/
npm run preview -- --nome="João" --genero=M         # um cartão de teste
npm run enviar -- --simular                         # simula o envio de hoje
npm run enviar                                      # envia os cartões de hoje
node src/index.js lista                             # mostra a lista importada
```

---

## O que você precisa saber

**Envio em massa pelo WhatsApp tem risco de bloqueio.** O sistema usa o
`whatsapp-web.js`, que controla o WhatsApp Web pelo seu próprio número — é a mesma coisa
que você mandando as mensagens, só que automatizado. Não é uma API oficial da Meta.
Para reduzir o risco, o envio já vai com pausa aleatória entre uma mensagem e outra
(25 a 70 segundos por padrão) e limite diário de 120. **Não diminua muito esses
intervalos** — mandar 30 mensagens em rajada é o que faz o WhatsApp marcar a conta como
spam. Com ~25 pessoas por dia, uma rodada leva cerca de 20 minutos.

**Números sem o nono dígito.** Alguns telefones do PDF estão com 8 dígitos. Na hora de
enviar, o sistema pergunta ao próprio WhatsApp qual é o número real (`getNumberId`), então
esses casos costumam funcionar. Quem não tem WhatsApp aparece como erro no histórico.

**13 pessoas do PDF de agosto não têm telefone** — são os nomes soltos no fim de cada
bloco (Carmen, Cida Farias, Arissa, Sebastiana, Adair, Ilda Meire, Tete, Dr. Diego,
Thais…). Eles aparecem na lista marcados como pendência; preencha o telefone à mão se
quiser que recebam.

**O gênero é deduzido do primeiro nome** por dicionário + terminação da palavra. Acerta a
grande maioria, mas nomes incomuns podem sair errados — por isso a aba de pendências
mostra quem ficou com gênero incerto. Cada correção sua fica salva em
`dados/genero-manual.json` e vale para sempre.

**Nunca manda duas vezes.** Todo envio fica registrado em `dados/enviados.json` e o
sistema pula quem já recebeu naquele dia, mesmo que você clique em enviar de novo.

**Dados pessoais.** As pastas `dados/`, `cartoes/` e `exemplos/` têm nome, endereço e
telefone de centenas de pessoas — o `.gitignore` já impede que isso vá para o GitHub.
Não remova essas linhas.

## Estrutura

```
src/
  index.js      comandos de terminal
  servidor.js   API do painel + publico/index.html
  pdf.js        extrai o texto do PDF (reconstruindo as linhas)
  parser.js     transforma o texto em registros de pessoas
  telefone.js   normaliza os números
  genero.js     deduz Amigo/Amiga e guarda suas correções
  cartao.js     escreve o nome sobre a arte
  whatsapp.js   conexão e envio
  envio.js      monta a fila do dia e dispara com pausas
  agenda.js     disparo diário no horário configurado
  db.js         lista importada + histórico de envios
config.json     posição do texto, fonte, horários, limites
```
