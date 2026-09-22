---
impacto: nada_mudou
secao: corrigido
titulo: Botões de assinatura usam a rota correta do checkout
---
Os botões mensal e anual passam a chamar /api/v1/billing/checkout. Antes, o
endereço sem /api/v1 retornava HTML sem chegar à integração de pagamento.
Respostas HTML deixam de aparecer no alerta e falhas internas da rota não
expõem mensagens técnicas. Não há alteração de preços ou meios de pagamento.
