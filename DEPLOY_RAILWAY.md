# Publicação no Railway — Dr. Brownie V2

## Estrutura

Envie os arquivos diretamente para a raiz do repositório. A raiz deve conter:

```text
package.json
server.js
public/
data/
```

Não envie o ZIP para dentro do repositório.

## Variáveis

```text
ADMIN_PASSWORD=crie-uma-senha-forte
DATA_DIR=/data
```

## Volume

Crie um volume no serviço e monte em:

```text
/data
```

O volume preserva sabores, custos, estoque, pedidos e resultados financeiros entre os deploys.

## Validação após o deploy

1. Abra `/api/health` e confirme `version: 2.0.0`.
2. Abra `/admin.html`.
3. Cadastre custo, preço e estoque de um sabor.
4. Faça um pedido pelo site.
5. Confirme que o estoque diminuiu.
6. Marque o pedido como entregue.
7. Confira faturamento, custo e lucro na aba Financeiro.
8. Cancele um pedido de teste e confirme a devolução ao estoque.
