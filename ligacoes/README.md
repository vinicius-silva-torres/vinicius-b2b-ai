# VWS Ligações

Painel local para ler a aba **B2B QUALIFICADOS**, usar os três roteiros da Vinicius Web Studio e registrar o resultado de cada ligação. O Phone Link faz a chamada a partir do Android pareado. Com dois chips, deixe a Veek como SIM principal.

## Abrir no Windows

1. Instale Node.js 22 ou posterior se o PC ainda estiver sem Node.
2. Abra `Iniciar.cmd`. Na primeira execução, sem configuração, ele abre a demonstração em `http://127.0.0.1:3842/`.
3. Selecione **Preparar número**, **Ligar agora** e aguarde o popup. Os contatos, chamadas e registros da demonstração são simulados. O comando `Iniciar.cmd --demo` abre a demonstração mesmo com uma planilha configurada.

A janela do terminal precisa continuar aberta enquanto você usa o painel.

## Conectar a planilha

Crie a pasta `%LOCALAPPDATA%\VWS-Ligacoes`. Copie `config.exemplo.json` para essa pasta com o nome `config.json` e informe o link da planilha no campo `planilha`. Coloque nessa pasta o JSON indicado em `credenciais`. Caminhos absolutos também são aceitos.

Escolha uma credencial do projeto Google Cloud com a **Google Sheets API** habilitada:

- **Conta de serviço.** Reutilize a credencial da automação de prospecção se a conta já tem acesso de edição à planilha. O arquivo JSON deve conter `type: service_account`.
- **OAuth para app de computador.** Baixe o JSON de um cliente OAuth do tipo **Aplicativo para computador**. Inclua sua conta como usuária de teste se o app estiver em modo de teste. Depois de abrir o painel, clique em **Conectar Google** e autorize a conta que tem acesso de edição. O painel guarda a autorização na pasta local acima. Autorizações em modo de teste podem expirar e exigir reconexão.

Reabra `Iniciar.cmd` após configurar. O modo real lê a aba por cabeçalho e cria **HISTÓRICO LIGAÇÕES** na primeira gravação. A atualização do lead e a inserção no histórico são feitas juntas em uma requisição ao Google Sheets. Guarde as credenciais e o link da planilha na configuração local.

Os campos opcionais `Nome do responsável` e `Link da prévia` aparecem no painel se estiverem na aba **B2B QUALIFICADOS**. Na planilha atual, o agente de pesquisa também pode incluir `Link da prévia: https://...` em uma linha própria de **Observações comerciais**. Contatos frios com link disponível sobem na fila, com o score como critério de desempate. Retornos que já chegaram ao horário vêm primeiro. Após **Quer a prévia**, o painel abre um rascunho no WhatsApp, com o link preenchido para você conferir e enviar.

Em **Falei com outra pessoa**, informe o nome do responsável e o melhor horário se souber. **Quer fechar** guarda a intenção em **Acompanhar** e sugere proposta ou pagamento. A etapa vira **Fechada** quando você usa **Marcar venda fechada** e confirma.

## Parear e testar o Phone Link

1. Abra **Vincular ao Celular → Chamadas**, conecte o POCO por Bluetooth e deixe a janela aberta.
2. Antes de ligar para um lead, faça uma rodada com uma cópia da planilha que tenha um número de teste sob seu controle. O atalho `Iniciar.cmd --live` abre a configuração real mesmo se o arquivo ainda estiver ausente.
3. **Preparar número** preenche o campo do Phone Link. **Ligar agora** verifica novamente o telefone no discador e aciona o botão de chamada.
4. Ao observar a chamada e o retorno da interface ao estado ocioso, o painel abre **Como foi a ligação?**. Os estados vêm da interface do Phone Link, que pode variar com a versão e o idioma do Windows. O painel também oferece **Diagnóstico do Phone Link** e **Registrar resultado** para revisão manual.
5. **Salvar e avançar** grava a tentativa e prepara o telefone do próximo contato na fila de ligações. Cada ligação começa quando você confirma.

Se o Phone Link não expuser o campo de número ou o botão da sua versão, use **Copiar telefone** e **Abrir Phone Link**. O diagnóstico também precisa de autorização para executar scripts locais do PowerShell no Windows.

## Testes locais

Execute `node --test ligacoes/flow.test.mjs` na raiz do repositório. É possível abrir a demonstração em outros sistemas com `node ligacoes/server.mjs --demo`.

## Usar pelo chat do OpenBot

No OpenBot que roda no Dell, adicione um servidor MCP local por comando. Use `node` como executável e, como argumento, o caminho completo de `ligacoes\agent.mjs`. A instalação no Dell inclui `openbot-mcp.json` na pasta `%LOCALAPPDATA%\VWS-Ligacoes` para importar esse servidor, se a versão do OpenBot oferecer importação. Ative-o apenas no agente de prospecção e use [AGENTE-LIGACOES.md](AGENTE-LIGACOES.md) nas instruções do agente. Mantenha o painel aberto no mesmo Windows. O servidor oferece sete ferramentas, entre elas preparar telefone, consultar a tentativa, registrar o resultado e confirmar venda.

O MCP usa a mesma fila e o mesmo registro do painel. A configuração `planilha` pode receber outro link ou ID, desde que a planilha tenha a aba **B2B QUALIFICADOS** com os mesmos cabeçalhos. A conexão atual usa a API do Google Sheets. Se trocar por outra integração, basta adaptar a camada que fornece `snapshot()` e `save(entry)` em `sheets.mjs`; painel e MCP usam a mesma API local.
