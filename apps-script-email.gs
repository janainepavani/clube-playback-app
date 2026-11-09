// Script do e-mail de aviso do app Trio Playback.
// Fica no Google Apps Script da conta janaine@janainepavani.com e envia o e-mail quando a Janaine toca em Liberar no Painel.
// Implantar como App da Web: Executar como "Eu", Quem pode acessar "Qualquer pessoa".
// A CHAVE precisa ser igual à que está no Painel do app (E-mail de aviso ao liberar).

const CHAVE = "COLE_AQUI_A_CHAVE";
const APP_URL = "https://app.playback.janainepavani.com";
const WHATS = "https://wa.me/5541998771712";
const ASSUNTO = "Seu acesso ao app do Trio Playback foi liberado";

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.k !== CHAVE) return saida("chave");
    const to = String(d.to || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return saida("email");
    // evita mandar o mesmo e-mail duas vezes seguidas para a mesma pessoa (10 minutos)
    const cache = CacheService.getScriptCache();
    if (cache.get(to)) return saida("repetido");
    cache.put(to, "1", 600);
    GmailApp.sendEmail(to, ASSUNTO, texto(), { htmlBody: html(), name: "Janaine Pavani" });
    return saida("ok");
  } catch (err) {
    return saida("erro");
  }
}

function saida(s) { return ContentService.createTextOutput(s); }

function texto() {
  return "Olá!\n\n" +
    "Seu acesso ao app do Trio Playback foi liberado.\n\n" +
    "Para entrar, abra " + APP_URL + " e use o mesmo e-mail e a senha que você criou.\n\n" +
    "Dica: no iPhone, abra o link no Safari, toque em Compartilhar e depois em \"Adicionar à Tela de Início\". No Android, abra no Chrome e toque em \"Instalar app\". Assim o app fica no seu celular como qualquer outro.\n\n" +
    "Se esquecer a senha, toque em \"Esqueci minha senha\" na tela de entrada.\n\n" +
    "Qualquer dúvida, é só responder este e-mail ou me chamar no WhatsApp: " + WHATS + "\n\n" +
    "Um abraço,\nJanaine Pavani";
}

function html() {
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:520px">' +
    '<p>Olá!</p>' +
    '<p>Seu acesso ao app do <b>Trio Playback</b> foi liberado.</p>' +
    '<p>Para entrar, use o mesmo e-mail e a senha que você criou:</p>' +
    '<p style="margin:24px 0"><a href="' + APP_URL + '" style="background:#b8956a;color:#111;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Abrir o app</a></p>' +
    '<p><b>Dica:</b> no iPhone, abra o link no Safari, toque em Compartilhar e depois em "Adicionar à Tela de Início". No Android, abra no Chrome e toque em "Instalar app". Assim o app fica no seu celular como qualquer outro.</p>' +
    '<p>Se esquecer a senha, toque em "Esqueci minha senha" na tela de entrada.</p>' +
    '<p>Qualquer dúvida, é só responder este e-mail ou me chamar no <a href="' + WHATS + '">WhatsApp</a>.</p>' +
    '<p>Um abraço,<br>Janaine Pavani</p>' +
    '</div>';
}

// Para testar direto no editor: escolha "testar" e clique em Executar. Manda o e-mail para você.
function testar() {
  GmailApp.sendEmail("janaine@janainepavani.com", ASSUNTO, texto(), { htmlBody: html(), name: "Janaine Pavani" });
}
