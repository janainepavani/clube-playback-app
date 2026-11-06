# App Trio Playback (Clube Playback)

Web app instalável (PWA) para assinantes do Trio Playback: vídeo de karaokê, letra e partitura por tom, playlists, modo apresentação e uso sem internet.

## Como funciona
- **Login:** e-mail e senha (Firebase Authentication). Primeiro acesso cria a senha.
- **Liberação:** e-mail na coleção `allowed` entra direto; os demais ficam `pending` até a Janaine liberar no painel.
- **Painel da Janaine:** só para `janaine@janainepavani.com` com e-mail confirmado. Pedidos, assinantes, e-mails autorizados, músicas e chave do offline.
- **Arquivos:** Firebase Storage em `songs/{id}/...`. Só assinante ativa lê; só a Janaine envia.
- **Offline:** arquivos guardados no IndexedDB, criptografados (AES-GCM) com a chave de `config/offline`. Libera no 8º dia após a ativação. O app precisa se conectar a cada 7 dias; se a conta deixar de estar ativa, apaga tudo na próxima conexão.
- **Marca:** e-mail da assinante sobre o vídeo.

## Dados (Firestore)
- `allowed/{email}`
- `users/{uid}`: email, status (`active` | `pending` | `blocked`), activatedAt, prefKeys
- `users/{uid}/playlists/{id}`: name, items (ids das músicas)
- `songs/{id}`: name, bpm, letra (caminho), keys [{key, video, sheet}]
- `config/offline`: k (chave base64)

## Publicar
1. Regras: copiar `firestore.rules` e `storage.rules` no console do Firebase (aba Regras de cada produto).
2. Storage: ativar no plano Blaze, com alerta de orçamento.
3. CORS do bucket (Cloud Shell): `gsutil cors set cors.json gs://clube-playback.firebasestorage.app`
4. Hospedagem: GitHub Pages deste repositório (branch main, pasta raiz).
5. Firebase Authentication > Configurações > Domínios autorizados: adicionar o domínio do GitHub Pages.

## Vídeos
Exportar com HandBrake, predefinido "Clube App": Fast 720p30, RF 24, áudio AAC Passthru, Web Optimized.
Letra e partitura: imagens JPG ou PNG.
