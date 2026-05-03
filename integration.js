const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Game = require('./Game');
//const db = require("./config/firebase");   //uncomment after implementing firebase

const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 3000;
const gameSessions = new Map();

const ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";



function generateRoomCode() {
  let code;

  do {
    code = "";
    for (let i = 0; i < 6; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (gameSessions.has(code));

  return code;
}

function normalizeRoomCode(roomCode) {
  return String(roomCode || "").trim().toUpperCase();
}

function getSession(socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return null;
  return gameSessions.get(roomCode) || null;
}

function getGame(socket) {
  const session = getSession(socket);
  return session ? session.game : null;
}

function leaveCurrentRoom(socket) {
  const oldRoomCode = socket.data.roomCode;
  if (!oldRoomCode) return;

  const oldSession = gameSessions.get(oldRoomCode);
  if (!oldSession) {
    socket.data.roomCode = null;
    return;
  }

  socket.leave(oldRoomCode);
  oldSession.sockets.delete(socket.id);

  const removedPlayer = oldSession.game.removePlayer(socket.id);

  if (removedPlayer) {
    console.log(`Removed ${removedPlayer.character} from room ${oldRoomCode}.`);
  }

  if (oldSession.sockets.size === 0) {
    console.log(`Room ${oldRoomCode} is empty. Deleting session.`);
    gameSessions.delete(oldRoomCode);
  } else {
    oldSession.game.broadcastGameState();
  }

  socket.data.roomCode = null;
}



app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => {
  res.send('Clue-less server is running');
});


//socket events
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  socket.on("CREATE_ROOM", () => {
    leaveCurrentRoom(socket);

    const roomCode = generateRoomCode();
    const game = new Game(io, roomCode);

    gameSessions.set(roomCode, {
      game,
      sockets: new Set([socket.id])
    });

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    console.log(`Room created: ${roomCode} by ${socket.id}`);

    socket.emit("ROOM_CREATED", { roomCode });
  });

  socket.on("JOIN_ROOM", ({ roomCode }) => {
    const normalizedCode = normalizeRoomCode(roomCode);

    if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) {
      socket.emit("ROOM_JOIN_FAILED", {
        message: "Room code must be 6 letters/numbers."
      });
      return;
    }

    const session = gameSessions.get(normalizedCode);

    if (!session) {
      socket.emit("ROOM_JOIN_FAILED", {
        message: "Room not found."
      });
      return;
    }

    leaveCurrentRoom(socket);

    socket.join(normalizedCode);
    socket.data.roomCode = normalizedCode;
    session.sockets.add(socket.id);

    console.log(`${socket.id} joined room ${normalizedCode}`);

    socket.emit("ROOM_JOINED", { roomCode: normalizedCode });
    socket.emit("GAME_STATE_UPDATE", session.game.getGameState());
  });

  //handle disconnect. For now, it deletes player but later, implement differing response based on reason
  socket.on("disconnect", (reason) => {
    console.log(`Player disconnected: ${socket.id} (${reason})`);
    leaveCurrentRoom(socket);
  });
  
  socket.on('JOIN_GAME', ({ character }) => {
    const currentGame = getGame(socket);
    if (!currentGame) {
      socket.emit('JOIN_FAILED', { message: 'You are not in a room.' });
      return;
    }
    
    const roomCode = socket.data.roomCode;
    
    console.log(`JOIN_GAME received from ${socket.id} as ${character}`);

    if (currentGame.addPlayer(socket.id, character)) {
      socket.emit('JOIN_SUCCESS', {
        character: character, 
        roomCode: roomCode 
      });

      console.log('Player:', socket.id, " selected", { character }, "in room", roomCode);
      currentGame.broadcastGameState();
    } else{
      socket.emit('JOIN_FAILED',{message: 'Character already taken'})
      console.log('Player:', socket.id, " selected", { character }, "but is duplicate character");
    }
  });

  socket.on('START_GAME', () => {
    const currentGame = getGame(socket);

    if (!currentGame) {
      socket.emit('START_GAME_FAILED', { message: 'You are not in a room.' });
      return;
    }

    const roomCode = socket.data.roomCode;

    console.log(`START_GAME requested by ${socket.id} in room ${roomCode}`);

    const success = currentGame.startGame();

    if (success) {
      io.to(roomCode).emit('GAME_STARTED', currentGame.getGameState());
      currentGame.broadcastGameState();
    } else {
      socket.emit('START_GAME_FAILED', {
        message: 'At least 3 players are required and all players must be ready.'
      });
    }
  });

  socket.on('TOGGLE_READY', () => {
    const currentGame = getGame(socket);

    if (!currentGame) {
      socket.emit('READY_FAILED', { message: 'You are not in a room.' });
      return;
    }

    const success = currentGame.toggleReady(socket.id);

    if (!success) {
      socket.emit('READY_FAILED', { message: 'Cannot change ready state right now.' });
      return;
    }

    currentGame.broadcastGameState();
  });

  socket.on('GET_GAME_STATE', () => {
    const currentGame = getGame(socket);

    if (!currentGame) return;

    socket.emit('GAME_STATE_UPDATE', currentGame.getGameState());
  });

  socket.on('MOVE', ({ targetLoc }) => {
    const currentGame = getGame(socket);

    if (!currentGame) {
      socket.emit('MOVE_FAILED', { message: 'You are not in a room.' });
      return;
    }

    const success = currentGame.playerMove(socket.id, targetLoc);

    if (!success) {
      socket.emit('MOVE_FAILED', { message: 'Invalid move.' });
    }
  });

  socket.on('SUGGESTION', ({ suspect, weapon }) => {
    const currentGame = getGame(socket);
    if (!currentGame) return;

    currentGame.makeSuggestion(socket.id, suspect, weapon);
  });

  socket.on('DISPROVE', ({ cardShown }) => {
    const currentGame = getGame(socket);

    if (!currentGame) {
      socket.emit('SUGGESTION_STATUS', { message: 'You are not in a room.' });
      return;
    }

    const success = currentGame.respondToSuggestion(socket.id, cardShown);

    if (!success) {
      socket.emit('SUGGESTION_STATUS', {
        message: 'Invalid disprove response.'
      });
    }
  });

  //accusation
  socket.on('ACCUSATION', ({ suspect, weapon, room }) => {
    const currentGame = getGame(socket);

    if (!currentGame) {
      socket.emit('ACCUSATION_RESULT', {
        correct: false,
        message: 'You are not in a room.'
      });
      return;
    }

    const result = currentGame.makeAccusation(socket.id, suspect, weapon, room);

    if (!result.success) {
      socket.emit('ACCUSATION_RESULT', {
        correct: false,
        message: 'Accusation could not be processed.'
      });
      return;
    }

    socket.emit('ACCUSATION_RESULT', {
      correct: result.correct,
      message: result.correct ? 'Correct accusation!' : 'Wrong accusation!'
    });
  });

  // Private hand request
  socket.on('GET_MY_HAND', () => {
    const currentGame = getGame(socket);

    if (!currentGame) {
      socket.emit('YOUR_HAND', []);
      return;
    }

    const hand = currentGame.getPrivateHand(socket.id);
    socket.emit('YOUR_HAND', hand);
  });

  socket.on('END_TURN', () => {
    const currentGame = getGame(socket);

    if (!currentGame) {
      socket.emit('END_TURN_FAILED', { message: 'You are not in a room.' });
      return;
    }

    const success = currentGame.endTurn(socket.id);

    if (!success) {
      socket.emit('END_TURN_FAILED', { message: 'Cannot end turn.' });
    }
  });




  //chat character colors  
  const characterColors = {
  "Miss Scarlet": "#ff0000",
  "Col. Mustard": "#ffff00",
  "Mrs. White": "#ffffff",
  "Mr. Green": "#39ff14",
  "Mrs. Peacock": "#00bfff",
  "Prof. Plum": "#9b30ff"
  };

  //chat
  socket.on("CHAT", ({ message }) => {
    const currentGame = getGame(socket);

    if (!currentGame) return;
    if (!message || !message.trim()) return;

    const roomCode = socket.data.roomCode;
    const player = currentGame.players.find(p => p.id === socket.id);
    const sender = player ? player.character : "Player";

    const chatMessage = {
      sender: sender,
      senderColor: characterColors[sender] || "#ffffff",
      message: message.trim().slice(0, 200),
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })
    };

    io.to(roomCode).emit("CHAT", chatMessage);
  });

});
  

server.listen(PORT, () => {
    console.log(`Clue-less Server running on port ${PORT}`);
});