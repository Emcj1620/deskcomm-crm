# Pagamento nativo — estado e operação

Implementação local: popup em Minha assinatura → cotação server-side → confirmação explícita → Asaas → conciliação → assinatura. Nenhuma cobrança é criada ao abrir o popup ou calcular valores.

## Limites deliberados

- Baixa manual de cobrança única é reconhecida após consulta autenticada ao Asaas (`status=RECEIVED_IN_CASH`, ou tipo `RECEIVED_IN_CASH` com status liquidado). ID, referência, cliente e total continuam obrigatórios. Não solicita QR após a baixa. Uma parcela baixada manualmente não liquida automaticamente o parcelamento inteiro. Desfazer baixa já liquidada exige análise administrativa, assim como estorno.

- Cartão fica desativado por padrão (`ASAAS_NATIVE_CARD_ENABLED=false`). A instalação pode habilitá-lo explicitamente. Em 22/09/2026 o operador autorizou a liberação para seu próprio teste real; foram verificados testes automatizados, HTTPS, mascaramento do formulário, remoção do corpo na telemetria e simulações de taxas na API de produção. Não houve cobrança de cartão feita pelo agente nem homologação sandbox. A integração direta recebe dados de cartão no servidor; não é tokenização client-side nem uma certificação PCI. A conformidade PCI-DSS continua sendo responsabilidade do operador.
- Não há débito recorrente: cada pagamento compra um período mensal/anual. Pix é à vista; cartão oferece de 1 a 12 parcelas. A taxa de recebimento é consultada na conta, calculada para repasse e confrontada com o simulador. Não inclui antecipação.
- A renovação do mesmo plano preserva dias pagos. Troca de plano ativo depende da regra comercial do operador; até ela ser definida, a API recusa a troca antes de criar cobrança.
- Resposta incerta mantém a tentativa bloqueada. Consultar pelo ID da tentativa/externalReference no Asaas; não liberar o bloqueio nem recriar cobrança por suposição. Sem pagamento encontrado após timeout, requer investigação operacional.
- Estornos/chargebacks de pagamento já liquidado exigem acompanhamento pelo operador no Asaas e análise administrativa da assinatura; não existe revogação automática de períodos nesta implementação. A ativação do cartão não modifica essa limitação.
- Dados de cartão/CPF/endereço não são persistidos no CRM. O cliente Asaas é criado por tentativa com notificações desativadas para não alterar clientes de outros serviços.

## Validação necessária para publicação

Aplicar migration 0265 com o baseline/manifest correspondente. Testar duplicidade, isolamento entre organizações, recusa, timeout, webhook repetido, QR Code, confirmação e parcelas no sandbox. Validar visualmente desktop e celular. Sem sandbox, não declarar cartão homologado.

## Living System Checklist

1. Entrada: catálogo RLS + usuário admin da empresa, nunca preço/org do browser.
2. Saída: `tenant_subscriptions` e popup.
3. Registro: `billing.quote_created`, `billing.payment_submitted`, `billing.payment_confirmed` em auditoria.
4. Tela: `NativeCheckout`, status do pagamento e assinatura.
5. Porta: Configurações → Minha assinatura, já existente.
6. Retomada: GET busca tentativa pendente ao reabrir; timeout nunca autoriza novo débito.
7. Configuração: planos no super admin; chaves no servidor; cartão não habilitado aparece no popup.
8. IA/humano: não aplicável, pagamento depende de decisão humana explícita.
9. Retorno: webhook e polling conciliam a mesma tentativa; erro incerto bloqueia repetição.
10. Mapa: `docs/architecture/native-billing.json`.

Fontes: https://docs.asaas.com/docs/pci-dss ; https://docs.asaas.com/reference/criar-cobranca-com-cartao-de-credito ; https://docs.asaas.com/reference/simulador-de-vendas
