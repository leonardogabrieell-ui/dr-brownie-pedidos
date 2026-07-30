# Dr. Brownie Pedidos — V4.0 corrigida

Site completo para pedidos e gestão do Dr. Brownie.

## Cliente

- cardápio inicial com Ninho, Nutella e Cookies, fotos, preços e estoque real;
- seleção de quantidades;
- entregas somente às sextas, sábados e domingos;
- sem retirada;
- escolha da data disponível;
- endereço completo e observações;
- pedido salvo e estoque reservado antes de abrir o WhatsApp;
- pagamento manual por PIX após confirmação.

## Painel administrativo

- preço de custo e preço de venda por sabor;
- lucro unitário e margem estimada;
- estoque por sabor;
- valor investido no estoque atual;
- valor potencial de venda do estoque;
- pedidos por status;
- cancelamento com devolução automática do estoque;
- faturamento dos produtos separado da taxa de entrega;
- custo das unidades vendidas;
- lucro bruto dos produtos;
- margem bruta;
- quantidade vendida por sabor;
- relatório por hoje, últimos 7 dias, últimos 30 dias, mês atual ou todo o período.

## Regra financeira

Os resultados realizados consideram somente pedidos marcados como **Entregue**.

Quando o pedido é criado, o sistema salva dentro dele:

- preço de venda vigente;
- preço de custo vigente;
- custo total dos itens;
- lucro bruto estimado.

Assim, alterar o custo de um sabor depois não modifica o lucro dos pedidos antigos.

O lucro bruto não desconta combustível, embalagem, taxas, perdas ou outros custos operacionais.

## Publicar no Railway

1. Envie o conteúdo desta pasta para a raiz de um repositório no GitHub.
2. Crie um serviço no Railway conectado ao repositório.
3. Adicione um Volume e monte em `/data`.
4. Nas Variables, configure:

```text
ADMIN_PASSWORD=uma-senha-forte
DATA_DIR=/data
```

5. Aguarde o deploy.
6. Abra `/admin.html`, faça login e configure o WhatsApp.

O Railway define `PORT` automaticamente.

## Primeira configuração

1. Abra `https://seu-dominio/admin.html`.
2. Entre com a senha definida em `ADMIN_PASSWORD`.
3. O WhatsApp padrão já está configurado como `5519999200992`; altere em **Configurações** somente se necessário.
4. Ajuste taxa de entrega, pedido mínimo e capacidade diária.
5. Em **Sabores e estoque**, cadastre custo, preço de venda e estoque de cada sabor.
6. Faça um pedido de teste.
7. Marque o pedido como entregue e confira a aba **Financeiro**.

## Segurança

Nunca publique com a senha padrão. Sempre configure `ADMIN_PASSWORD` no Railway.


## Correções da V4

- corrigido o erro `Cannot read properties of null (reading 'reset')` no login administrativo;
- sabores iniciais corrigidos para Ninho, Nutella e Cookies;
- WhatsApp Dr. Brownie visível no site: (19) 99920-0992;
- botão principal alterado para **Finalizar pedido**;
- o pedido é registrado e o estoque é reservado antes de abrir o WhatsApp;
- cancelamento devolve as unidades ao estoque;
- arquivos JavaScript e CSS usam atualização sem cache antigo após o deploy.
