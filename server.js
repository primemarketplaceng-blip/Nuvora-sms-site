import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import MerlMovieSDK from "merlmovie-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

const server = createServer(app);

const WSS = new WebSocketServer({
  server,
  path: "/ws"
});

const sdk = new MerlMovieSDK({ WSS });

sdk.handle({
  async onStream({ controller, request, media }) {
    try {
      console.log("Incoming media request:", media);

      // Provider integrations will be connected here.
      // Only verified, authorized playable links will be returned.

      const result = {
        qualities: [],
        subtitles: []
      };

      if (result.qualities.length > 0) {
        controller.finish(result);
      } else {
        controller.failed();
      }
    } catch (error) {
      console.error("Stream error:", error);
      controller.failed();
    }
  },

  onConnection(ws, request) {
    console.log("MerlMovie connected:", request.socket.remoteAddress);
  },

  onListening() {
    console.log("MelStream Auto WebSocket is ready.");
  }
});

app.get("/", (req, res) => {
  res.json({
    name: "MelStream Auto",
    version: "2.0.0",
    status: "running"
  });
});

server.listen(PORT, () => {
  console.log(`MelStream Auto running on port ${PORT}`);
});
