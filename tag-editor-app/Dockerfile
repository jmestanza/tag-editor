FROM node:18

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy the rest of the application
COPY . .

# Generate Prisma client and build
RUN npx prisma generate
RUN npm run build

ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=3072"
EXPOSE 3000

CMD ["npm", "start"]
