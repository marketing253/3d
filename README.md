# Precificador de Impressões 3D

Sistema para cadastrar produtos impressos em 3D (Bambu Lab A1 Combo), calcular o custo real e o preço de venda por canal (venda direta, Mercado Livre e Shopee), com login e senha.

- **Login com senha:** senhas guardadas com bcrypt, sessão em cookie `httpOnly`, limite de 10 tentativas a cada 15 minutos.
- **Três tipos de acesso:** Administrador (tudo, inclusive usuários), Editor (cadastra e edita) e Só leitura (só consulta).
- **Produtos:** foto, link do modelo, filamentos, tempo, custo por unidade e ranking de lucro por hora de impressora.
- **Pedidos e encomendas:** cliente, WhatsApp, itens com personalização, sinal, prazo e status (orçamento → aprovado → imprimindo → pronto → entregue). Ao entregar, a venda entra sozinha no financeiro.
- **Mensagens prontas para o WhatsApp:** orçamento, confirmação, pedido pronto, cobrança e agradecimento.
- **Fila da impressora:** ordem de impressão por prazo, horas de máquina, previsão de cada pedido e aviso de atraso.
- **Estoque:** rolos de filamento (o consumo sai sozinho quando o pedido fica pronto) e peças à pronta entrega.
- **Catálogo público** em `/catalogo`: sem login, com fotos, preços e carrinho que envia o pedido pelo WhatsApp.
- **Financeiro:** vendas (com taxa do canal, frete e lucro calculados), despesas e receitas, saldo do mês e acumulado, contas a pagar e a receber, gráfico dos últimos 12 meses, despesas por categoria, mais vendidos e exportação em CSV.
- **Dados:** banco SQLite e fotos ficam na pasta `data/` (fora do Git).

## Rodar no seu computador

Requisito: Node.js 20 ou mais novo.

```bash
npm install
cp .env.example .env      # em casa, deixe COOKIE_SECURE=false
npm start
```

Abra http://localhost:3000. No primeiro acesso, a tela pede para criar o administrador.

## Publicar na VPS (Ubuntu/Debian, com Node + nginx)

```bash
# 1. Instalar Node 22, nginx e certbot
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx build-essential

# 2. Baixar o código
sudo git clone https://github.com/marketing253/3d.git /opt/precificador
cd /opt/precificador
sudo npm install --omit=dev

# 3. Configurar
sudo cp .env.example .env
sudo nano .env            # COOKIE_SECURE=true e um SESSION_SECRET (openssl rand -hex 32)
sudo mkdir -p data && sudo chown -R www-data:www-data data .env

# 4. Deixar rodando como serviço
sudo cp deploy/precificador.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now precificador
sudo systemctl status precificador

# 5. nginx + HTTPS (troque o domínio no arquivo antes)
sudo cp deploy/nginx.conf /etc/nginx/sites-available/precificador
sudo ln -s /etc/nginx/sites-available/precificador /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d precificador.seudominio.com.br
```

O domínio precisa apontar para o IP da VPS (registro A no DNS) antes do certbot.

**Use sempre HTTPS em produção.** Sem ele, a senha trafega aberta na internet.

### Alternativa com Docker

```bash
cp .env.example .env && nano .env
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
```

Depois configure o nginx igual ao passo 5.

## Atualizar depois de mudar o código

```bash
cd /opt/precificador
sudo git pull
sudo npm install --omit=dev
sudo systemctl restart precificador
```

## Esqueci a senha do administrador

Na VPS, rode o comando abaixo. Ele pede a nova senha no terminal:

```bash
cd /opt/precificador
sudo -u www-data npm run criar-admin -- wellington "Wellington Freire"
```

O mesmo comando cria um administrador novo se o usuário não existir.

## Backup

Tudo fica em `data/`: o arquivo `precificador.db` e a pasta `fotos/`. Para fazer backup:

```bash
sudo sqlite3 /opt/precificador/data/precificador.db ".backup '/root/backup-precificador.db'"
sudo tar czf /root/fotos-precificador.tgz -C /opt/precificador/data fotos
```

## Estrutura

```
server.js            servidor, login e API
db.js                banco SQLite (tabelas criadas sozinhas)
scripts/             criar usuário ou trocar senha pelo terminal
public/              telas (index.html, app.css, app.js)
deploy/              nginx e systemd
```
