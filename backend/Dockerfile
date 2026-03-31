FROM node:20-alpine

WORKDIR /app

# Copy package files first — Docker caches this layer so npm install
# only re-runs when dependencies actually change, not on every code change
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/server.js"]
