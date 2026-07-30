# Dr. Brownie — passo a passo para publicar

## 1) Preparar os arquivos
1. Baixe o arquivo `Dr_Brownie_Pedidos_V3_Identidade_Visual_UPLOAD_UNICO.zip`.
2. Extraia o ZIP no computador.
3. Abra a pasta extraída. Você verá arquivos como `package.json`, `server.js` e a pasta `public`.

## 2) Enviar para o GitHub
Se o repositório estiver vazio:
1. Abra o repositório no GitHub.
2. Clique em **Add file > Upload files**.
3. Arraste **todo o conteúdo da pasta extraída** para a área de upload.
4. No campo de commit, escreva: `Instalar Dr. Brownie V3`.
5. Clique em **Commit changes**.

Se o repositório já tiver arquivos antigos:
1. Apague os arquivos antigos do repositório.
2. Depois envie o conteúdo da pasta nova.
3. Faça o commit.

## 3) Criar projeto no Railway
1. Entre no Railway.
2. Clique em **New Project**.
3. Escolha **Deploy from GitHub repo**.
4. Selecione o repositório do Dr. Brownie.
5. Aguarde o primeiro deploy.

## 4) Criar volume de dados
1. Dentro do projeto no Railway, clique em **+ New** ou adicione um volume.
2. Crie um volume com qualquer nome, por exemplo `dr-brownie-volume`.
3. Monte o volume em: `/data`

## 5) Adicionar variáveis
Na aba **Variables**, adicione:

```env
ADMIN_PASSWORD=sua-senha-forte
DATA_DIR=/data
PORT=3000
```

## 6) Gerar novo deploy
1. Depois de salvar as variables e montar o volume, clique em **Redeploy** se necessário.
2. Aguarde o projeto ficar como **Active**.

## 7) Abrir o site
1. Abra a URL pública do Railway.
2. Você verá o cardápio do Dr. Brownie.
3. Para entrar no painel administrativo, acesse `/admin.html`.

## 8) Configuração inicial no painel
1. Entre com a senha definida em `ADMIN_PASSWORD`.
2. Vá em **Configurações**.
3. Informe:
   - nome da marca;
   - número do WhatsApp que receberá os pedidos;
   - taxa de entrega;
   - pedido mínimo;
   - máximo de pedidos por data;
   - aviso do topo;
   - mensagem de pagamento.
4. Salve.
5. Vá em **Sabores e estoque** e cadastre os produtos.
6. Defina custo, preço de venda, estoque e foto.

## 9) Teste final
1. Faça um pedido teste pelo site.
2. Veja se ele chega ao WhatsApp corretamente.
3. Entre no painel e confirme se o pedido foi salvo.
4. Teste marcar como pago, saiu para entrega e entregue.
5. Verifique a aba **Financeiro**.

## 10) Depois disso
- Quando tudo estiver funcionando, você pode usar um domínio próprio.
- Se quiser, a próxima etapa pode ser integrar pagamento automático.
