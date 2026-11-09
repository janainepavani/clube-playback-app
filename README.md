# App Trio Playback (Clube Playback)

Web app instalável (PWA) para assinantes do Trio Playback: vídeo com letra (lyric video), letra e partitura por tom, playlists, modo apresentação e uso sem internet.

## Como funciona
- **Login:** e-mail e senha (Firebase Authentication). Primeiro acesso cria a senha.
- **Liberação:** e-mail na coleção `allowed` entra direto; os demais ficam `pending` até a Janaine liberar no painel.
- **Painel da Janaine:** só para `janaine@janainepavani.com` com e-mail confirmado. Pedidos, assinantes, e-mails autorizados, músicas e chave do offline.
- **Arquivos:** Firebase Storage em `songs/{id}/...`. Só assinante ativa lê; só a Janaine envia.
- **Offline:** arquivos guardados no IndexedDB, criptografados (AES-GCM) com a chave de `config/offline`. Libera assim que a conta é ativada. O app precisa se conectar a cada 7 dias; se a conta deixar de estar ativa, apaga tudo na próxima conexão.
- **Marca:** e-mail da assinante sobre o vídeo.
- **Aviso de liberação:** ao tocar em Liberar, o app chama um script do Google (Apps Script, na conta janaine@janainepavani.com) que envia o e-mail de boas-vindas. Endereço do script e chave ficam em `private/mail` (só a Janaine lê). O código do script está em `apps-script-email.gs` (a chave real fica só no script e no painel).

## Dados (Firestore)
- `allowed/{email}`
- `users/{uid}`: email, status (`active` | `pending` | `blocked`), activatedAt, prefKeys
- `users/{uid}/playlists/{id}`: name, items (ids das músicas)
- `songs/{id}`: name, formacao (`trio` | `piano`; sem o campo = trio), bpm, letra (caminho), keys [{key, video, sheets}]. A mesma música pode existir nas duas formações (id da versão Piano termina em `-piano`). O catálogo mostra um selo Trio/Piano e um filtro Todas/Trio/Piano.
- `config/offline`: k (chave base64)
- `private/mail`: url, k (script do e-mail de aviso)

## Publicar
1. Regras: copiar `firestore.rules` e `storage.rules` no console do Firebase (aba Regras de cada produto).
2. Storage: ativar no plano Blaze, com alerta de orçamento.
3. CORS do bucket (Cloud Shell): `gsutil cors set cors.json gs://clube-playback.firebasestorage.app`
4. Hospedagem: GitHub Pages deste repositório (branch main, pasta raiz).
5. Firebase Authentication > Configurações > Domínios autorizados: adicionar o domínio do GitHub Pages.

## Vídeos
Exportar com HandBrake, predefinido "Clube App": Fast 720p30, RF 24, áudio AAC Passthru, Web Optimized.
Letra e partitura: imagens JPG ou PNG.
