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

Os campos opcionais `Nome do responsável` e `Link da prévia` aparecem no painel se você adicionar essas colunas na aba **B2B QUALIFICADOS**. O painel usa **Prévia pronta?** para escolher como apresentar a oferta. **Quer fechar** registra a intenção e a próxima ação. Uma venda entra como **Fechada** quando você confirma na planilha.

## Parear e testar o Phone Link

1. Abra **Vincular ao Celular → Chamadas**, conecte o POCO por Bluetooth e deixe a janela aberta.
2. Antes de ligar para um lead, faça uma rodada com uma cópia da planilha que tenha um número de teste sob seu controle. O atalho `Iniciar.cmd --live` abre a configuração real mesmo se o arquivo ainda estiver ausente.
3. **Preparar número** preenche o campo do Phone Link. **Ligar agora** verifica novamente o telefone no discador e aciona o botão de chamada.
4. Ao observar a chamada e o retorno da interface ao estado ocioso, o painel abre **Como foi a ligação?**. Os estados vêm da interface do Phone Link, que pode variar com a versão e o idioma do Windows. O painel também oferece **Diagnóstico do Phone Link** e **Registrar resultado** para revisão manual.
5. **Salvar e avançar** grava a tentativa e mostra o próximo contato. Cada ligação continua sob seu comando.

Se o Phone Link não expuser o campo de número ou o botão da sua versão, use **Copiar telefone** e **Abrir Phone Link**. O diagnóstico também precisa de autorização para executar scripts locais do PowerShell no Windows.

## Testes locais

Execute `node --test ligacoes/flow.test.mjs` na raiz do repositório. É possível abrir a demonstração em outros sistemas com `node ligacoes/server.mjs --demo`.
