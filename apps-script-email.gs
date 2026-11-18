// Script do e-mail de aviso do app Trio Playback.
// Fica no Google Apps Script da conta janaine@janainepavani.com e envia o e-mail quando a Janaine toca em Liberar no Painel.
// Implantar como App da Web: Executar como "Eu", Quem pode acessar "Qualquer pessoa".
// A CHAVE precisa ser igual à que está no Painel do app (E-mail de aviso ao liberar).

const CHAVE = "COLE_AQUI_A_CHAVE";
const APP_URL = "https://app.playback.janainepavani.com";
const WHATS = "https://wa.me/5541998771712";
const ASSUNTO = "Seu acesso ao app do Trio Playback foi liberado";

const EU = "janaine@janainepavani.com";

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    const cache = CacheService.getScriptCache();
    const emailOk = x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);

    // Mensagem nova de assinante: vai SEMPRE só para a Janaine (por isso não precisa de chave)
    if (d.tipo === "paraJanaine") {
      const de = String(d.de || "").trim().toLowerCase();
      if (!emailOk(de)) return saida("email");
      if (cache.get("sup:" + de)) return saida("repetido");          // no máximo 1 aviso a cada 2 minutos por pessoa
      const total = +(cache.get("sup:total") || 0);
      if (total >= 40) return saida("limite");                         // no máximo 40 avisos por hora
      cache.put("sup:" + de, "1", 120); cache.put("sup:total", String(total + 1), 3600);
      const txt = String(d.texto || "").slice(0, 1500);
      GmailApp.sendEmail(EU, "Nova mensagem no app: " + de,
        de + " escreveu no app do Trio Playback:\n\n" + (txt || "(sem texto)") + (d.print ? "\n\n[mandou um print, veja no app]" : "") +
        "\n\nResponda pelo app: " + APP_URL + " (Conta > Painel da Janaine > Mensagens)",
        { name: "App Trio Playback" });
      return saida("ok");
    }

    if (d.k !== CHAVE) return saida("chave");

    // Resposta da Janaine: avisa a assinante que tem resposta no app
    if (d.tipo === "resposta") {
      const to = String(d.to || "").trim().toLowerCase();
      if (!emailOk(to)) return saida("email");
      if (cache.get("resp:" + to)) return saida("repetido");          // no máximo 1 aviso a cada 5 minutos por pessoa
      cache.put("resp:" + to, "1", 300);
      GmailApp.sendEmail(to, "A Janaine respondeu sua mensagem no app",
        "Olá!\n\nA Janaine respondeu sua mensagem no app do Trio Playback.\n\nPara ler, abra o app e toque em Conta > Fale com a Janaine:\n" + APP_URL + "\n\nUm abraço,\nJanaine Pavani",
        { name: "Janaine Pavani" });
      return saida("ok");
    }
    const to = String(d.to || "").trim().toLowerCase();
    if (!emailOk(to)) return saida("email");
    // evita mandar o mesmo e-mail duas vezes seguidas para a mesma pessoa (10 minutos)
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
