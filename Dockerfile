FROM node:20-slim

WORKDIR /app

# Copy server code
COPY server/src/simple-server.js ./src/
COPY server/package.json ./

# Install dependencies
RUN npm install --only=production

# Expose port
EXPOSE 7860

# Start server
ENV PORT=7860
CMD ["node", "src/server.js"]
