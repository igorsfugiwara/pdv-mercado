# Pendências

Checklist do que falta resolver fora do código, com o comando e — o que costuma faltar em
checklist — **como saber que deu certo**.

Estado verificado em 27/08/2026.

---

## Já resolvido

| | O quê | Como confere |
|---|---|---|
| ✅ | Toolchain nativo (`build-essential`) | `gcc --version` responde |
| ✅ | Módulos nativos na ABI do Electron | o app abre e o log diz `[db] pronto` |
| ✅ | `gh` CLI autenticado | `gh auth status` mostra `igorsfugiwara` |
| ✅ | Repositório no GitHub com remote configurado | `git remote -v` aponta para `pdv-mercado` |
| ✅ | `virt-manager` instalado | `virt-manager --version` responde |

---

## 1. Decidir a visibilidade do repositório e publicar

**Por que importa.** O repositório está **público**. É código de PDV comercial, com lógica
fiscal e regra de negócio de um cliente. Público não é errado — só precisa ser escolha, não
acidente. E o que é indexado enquanto está aberto não volta atrás.

Há **3 commits locais não publicados**. Não vou empurrar enquanto isso não estiver decidido.

Para fechar:

```bash
gh repo edit igorsfugiwara/pdv-mercado --visibility private
```

Depois, publicar o que está local:

```bash
git push origin main
```

**Como saber que deu certo:**

```bash
gh repo view igorsfugiwara/pdv-mercado --json visibility,pushedAt
```

`visibility` no valor que você escolheu, e `git status -sb` sem "à frente".

---

## 2. Criar a máquina virtual

**Por que importa.** Interface e funcionalidade você já testa direto na sua máquina. A VM
serve para três coisas que a máquina de desenvolvimento não prova:

- **instalação limpa** (RNF-07) — o `.AppImage`/`.deb` num Ubuntu sem seu `node_modules`;
- **queda de energia** — reset forçado testa o cache de disco, não só o WAL do SQLite;
- **Windows**, que é o alvo provável do supermercado.

**Atenção à memória.** Esta máquina tem 5,2 GB no total. Ubuntu convidado com 3 GB funciona
fechando outras coisas; Windows 10 pede 4 GB de forma realista e vai doer. Sugestão: faça o
Ubuntu aqui e deixe o Windows para a máquina do cliente ou um host maior.

Abra o `virt-manager` (já instalado) e crie uma VM Ubuntu Desktop 24.04 com 3 GB de RAM e
25 GB de disco. Baixe a ISO em [ubuntu.com/download/desktop](https://ubuntu.com/download/desktop).

Depois de instalada, gere o pacote na máquina de desenvolvimento e leve para a VM:

```bash
cd /home/user/github/pdv-mercado && npm run build:linux
```

**Como saber que deu certo:** o `.AppImage` de `release/` abre na VM, chega na tela de
login e entra com `caixa` / `caixa123` — tudo isso **sem** `npm`, `node` ou compilador
instalados lá dentro. Se precisar de algo além do arquivo, o empacotamento está incompleto.

O roteiro do que testar depois está em [`TESTES_VM.md`](TESTES_VM.md) §5.

---

## 3. Levantar as especificações do hardware

**Por que importa.** Não bloqueia implementação — o código já é genérico e configurável.
Bloqueia a **validação** na integração, e descobrir um protocolo errado no dia da instalação
é caro.

O que preciso saber:

| Equipamento | O que descobrir | Onde |
|---|---|---|
| **Impressora** | modelo, e se é USB ou rede (se rede, o IP) | etiqueta do equipamento / painel do roteador |
| **Balança** | modelo, protocolo (Toledo ou Filizola), porta serial e baud rate | manual do equipamento |
| **Etiqueta de balança** | layout: código+**peso** ou código+**valor**; e o prefixo | bipe uma etiqueta e leia os 13 dígitos |
| **Leitor de código** | confirmar que está com **sufixo Enter** | manual de configuração do leitor |

**Como descobrir o layout da etiqueta sem manual:** bipe uma etiqueta de um produto de peso
conhecido num campo de texto qualquer. Se os 5 dígitos do meio corresponderem ao peso em
gramas (1,5 kg → `01500`), é código+peso. Se corresponderem ao preço em centavos
(R$ 12,90 → `01290`), é código+valor. Me mande os 13 dígitos e o peso/preço do produto que
eu digo qual é.

---

## 4. Habilitação fiscal

**Por que importa.** Só quando a NFC-e deixar de ser simulada. Nada disso é necessário
agora, e nenhuma fatia em andamento depende disso.

O checklist operacional completo está na seção 7.4 do
[PRD original](PRD-PDV-Supermercado.md). Em resumo:

1. **Certificado e-CNPJ A1** numa AC do ICP-Brasil (Serasa, Certisign, Soluti, Valid,
   Safeweb). Validação por videoconferência, R$ 150–300/ano.
2. **Credenciamento NFC-e** no portal da SEFAZ-SP, com login pelo certificado.
3. **CSC + IdToken** gerados no portal, para homologação e para produção.
4. **Cadastro fiscal dos produtos** (NCM, CEST, CFOP, CSOSN, PIS/COFINS) — este exige
   contador responsável; os outros três você executa sozinho.

**Como saber que deu certo:** a bateria de homologação da seção 9.3 do PRD passa 100%.

---

## Apêndice — "API não encontrada"

Se aparecer esta mensagem, você abriu o endereço do Vite (`localhost:5173`) num navegador.

**Esse endereço não é o app.** Ele existe só para a janela do Electron carregar a interface
de dentro; sozinho não tem banco nem backend. O app abre em janela própria, chamada
**PDV Mercado** — `Alt`+`Tab` ou o ícone do Electron na barra de tarefas.

Desde a última correção, abrir esse endereço no navegador mostra uma tela explicando isso,
em vez de falhar no login.

Se sobrar processo de tentativa anterior, o Vite pula de porta e fica ambíguo qual instância
é qual. Para limpar tudo e subir uma só:

```bash
pkill -f "node_modules/.bin/vite"
```

```bash
cd /home/user/github/pdv-mercado && npm run dev
```

Precisa do DevTools? `PDV_DEVTOOLS=1 npm run dev` — ele não abre mais sozinho, justamente
porque a segunda janela confundia qual era o app.
