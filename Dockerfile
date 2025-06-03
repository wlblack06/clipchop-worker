FROM node:18

# Install required tools & yt-dlp from Python
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg \
  && pip3 install yt-dlp

# Set working directory
WORKDIR /app

# Install Node dependencies
COPY package.json ./
RUN npm install

# Copy the source code
COPY index.js ./

# Expose the app port
EXPOSE 3000

# Run the app
CMD ["npm", "start"]
