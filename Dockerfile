# Use the official Node.js image (Alpine is lightweight)
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the bot's source code
COPY . .

# Create the data directory for the persistent state file
RUN mkdir -p data

# Start the bot
CMD ["npm", "start"]