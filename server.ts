import express = require("express");
import http = require("http");
import { Server, Socket } from "socket.io";
import cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } // Adjust for production!
});

type Player = { wallet: string; score: number; taps: number };
type Match = {
  id: string;
  players: Record<string, Player>;
  state: "waiting" | "countdown" | "active" | "finished";
  countdownTime: number;
  gameTime: number;
  winner?: string;
};

type LobbyPlayer = { wallet: string; role: 'creator' | 'opponent'; deposited: boolean };
type Lobby = {
  id: string;
  players: Record<string, LobbyPlayer>;
  state: "waiting" | "ready";
  deposits: { creator: boolean; opponent: boolean };
};

const lobbies: Record<string, Lobby> = {};

const matches: Record<string, Match> = {};

io.on("connection", (socket: Socket) => {
  console.log("Client connected:", socket.id);

  // Join lobby
  socket.on("join_lobby", ({ lobbyId, wallet, role }) => {
    if (!lobbies[lobbyId]) {
      lobbies[lobbyId] = {
        id: lobbyId,
        players: {},
        state: "waiting",
        deposits: { creator: false, opponent: false }
      };
    }
    lobbies[lobbyId].players[wallet] = { wallet, role, deposited: false };
    socket.join(lobbyId);

    // Notify all players
    io.to(lobbyId).emit("lobby_update", {
      type: "lobby_update",
      playerCount: Object.keys(lobbies[lobbyId].players).length,
      status: lobbies[lobbyId].state
    });

    io.to(lobbyId).emit("player_joined", {
      type: "player_joined",
      playerCount: Object.keys(lobbies[lobbyId].players).length,
      wallet,
    });
  });

  // Handle deposit
  socket.on("deposit_made", ({ lobbyId, wallet }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
    const role = lobby.players[wallet]?.role;
    if (!role) return;

    lobby.deposits[role] = true;
    lobby.players[wallet].deposited = true;

    io.to(lobbyId).emit("deposit_confirmed", {
      type: "deposit_confirmed",
      role,
    });

    // If both deposited, lobby is ready
    if (lobby.deposits.creator && lobby.deposits.opponent) {
      lobby.state = "ready";
      io.to(lobbyId).emit("match_ready", {
        type: "match_ready"
      });
    }
  });

  socket.on("join_match", ({ matchId, wallet }) => {
    if (!matches[matchId]) {
      matches[matchId] = {
        id: matchId,
        players: {},
        state: "waiting",
        countdownTime: 3,
        gameTime: 10
      };
    }
    matches[matchId].players[wallet] = { wallet, score: 0, taps: 0 };
    socket.join(matchId);

    // Notify all players
    io.to(matchId).emit("update", {
      type: "player_joined",
      playerCount: Object.keys(matches[matchId].players).length
    });

    // Start game if 2 players
    if (Object.keys(matches[matchId].players).length === 2) {
      matches[matchId].state = "countdown";
      const countdownDuration = 3000; // 3 seconds in ms
      const countdownStart = Date.now();
      io.to(matchId).emit("update", {
        type: "countdown_start",
        startTime: countdownStart,
        duration: countdownDuration
      });

      setTimeout(() => {
        matches[matchId].state = "active";
        const gameDuration = 30000; // 30 seconds in ms
        const gameStart = Date.now();
        io.to(matchId).emit("update", {
          type: "game_start",
          startTime: gameStart,
          duration: gameDuration
        });

        setTimeout(() => {
          matches[matchId].state = "finished";
          // Calculate winner
          const scores = Object.values(matches[matchId].players).map(p => ({
            wallet: p.wallet,
            score: p.taps
          }));
          const winner = scores.reduce((a, b) => (a.score > b.score ? a : b)).wallet;
          io.to(matchId).emit("update", {
            type: "game_end",
            scores,
            winner
          });
        }, gameDuration);
      }, countdownDuration);
    }
  });

  socket.on("tap", ({ matchId, wallet }) => {
    const match = matches[matchId];
    if (match && match.state === "active" && match.players[wallet]) {
      match.players[wallet].taps += 1;
      io.to(matchId).emit("update", {
        type: "tap_update",
        wallet,
        taps: match.players[wallet].taps
      });
    }
  });

  socket.on("disconnecting", () => {
    for (const matchId of socket.rooms) {
      if (matches[matchId]) {
        io.to(matchId).emit("update", {
          type: "player_left",
          playerCount: Object.keys(matches[matchId].players).length - 1
        });
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(4000, () => {
  console.log("Socket.io server running on port 4000");
});