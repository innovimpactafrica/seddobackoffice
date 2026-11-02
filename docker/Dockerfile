# À lancer depuis la racine du projet :
#   docker build -f docker/Dockerfile -t seddo-backoffice .
#   docker run -p 8080:80 seddo-backoffice

# Étape 1 : build Angular
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Étape 2 : Nginx
FROM nginx:alpine

COPY --from=builder /app/dist/seddo-backoffice/browser /usr/share/nginx/html

# Toutes les routes sont en RenderMode.Client (app.routes.server.ts) : le build génère
# index.csr.html et non index.html ; sans ça, nginx sert sa page "Welcome to nginx!".
RUN mv /usr/share/nginx/html/index.csr.html /usr/share/nginx/html/index.html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
