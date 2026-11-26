# B2B Intelligence — painel de prospecção comercial

Interface web para visualizar e classificar oportunidades de presença digital entre pequenos negócios. O foco é transformar uma base de prospecção em informações mais fáceis de analisar.

**[Ver demonstração](https://vinicius-b2b-ai.conectaweb.workers.dev/)**

## Contexto do problema

Uma lista de estabelecimentos, sozinha, não mostra quais contatos exigem atenção. Este painel organiza indicadores e oportunidades por critérios comerciais, com foco em leitura rápida e apresentação visual.

## O que a interface implementa

- Indicadores de negócios mapeados e oportunidades de potencial elevado ou intermediário.
- Gráficos de distribuição e barras de progresso.
- Tabela de oportunidades com filtros, busca e paginação.
- Abas para separar diferentes estados de classificação.
- Carregamento de dados por `fetch` a partir de um endpoint externo do Cloudflare Worker.
- Exibição parcial de identificadores de empresas na interface.

> **Escopo:** a demonstração pública contém o painel web em `index.html`. A coleta dos dados, a planilha de origem e o código do Worker ficam fora do repositório.

## Ligações no Windows

O painel local carrega a fila do Google Sheets, apresenta três roteiros, prepara o número no Vincular ao Celular e registra o resultado de cada chamada. Abra [o guia de Ligações](ligacoes/README.md) para usar a demonstração ou conectar sua planilha.

## Tecnologias

`HTML5` · `CSS3` · `JavaScript` · `Fetch API` · `Cloudflare Workers`

## Executar

Abra `index.html` em um servidor local, por exemplo com Live Server. O painel depende de um endpoint de dados configurado no script; sem um endpoint acessível, os indicadores não serão carregados.

## Cuidados com dados

O projeto trabalha com informações comerciais. Antes de publicar uma versão real, é necessário revisar a exposição do endpoint, os dados devolvidos e as permissões de compartilhamento da planilha. O uso de nomes parciais na interface **não substitui controles de acesso**.

## Evolução planejada

- Documentar o formato esperado do JSON recebido do Worker.
- Separar HTML, CSS e JavaScript em arquivos próprios.
- Criar dados de exemplo para demonstração independente da API real.
- Implementar tratamento de erros e testes para os filtros.

**Autor:** Vinicius Silva Torres — Vinicius Web Studio.
