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
let currentGame = new Game(io);


app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => {
  res.send('Clue-less server is running');
});



io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  //handle disconnect. For now, it deletes player but later, implement differing response based on reason
  socket.on("disconnect", (reason) => {
    console.log(`Player disconnected: ${socket.id} (${reason})`);
    const removedPlayer = currentGame.removePlayer(socket.id);

    if (removedPlayer) {
      console.log(`Removed ${removedPlayer.character} from the game.`);

      if (currentGame.players.length === 0) {
        console.log("All players left. Resetting game state.");
        currentGame = new Game(io);
      } else {
        currentGame.broadcastGameState();
      }
    }
  });
  
  socket.on('JOIN_GAME', ({ character }) => {
    
    console.log(`JOIN_GAME received from ${socket.id} as ${character}`);

    if (currentGame.addPlayer(socket.id, character)) {
      socket.emit('JOIN_SUCCESS', {character: character });
      console.log('Player:', socket.id, " selected", { character });
      currentGame.broadcastGameState();
    } else{
      socket.emit('JOIN_FAILED',{message: 'Character already taken'})
      console.log('Player:', socket.id, " selected", { character }, "but is duplicate character");
    }
  });

  socket.on('START_GAME', () => {
    console.log(`START_GAME requested by ${socket.id}`);
    const success = currentGame.startGame();
    if (success){
      io.emit('GAME_STARTED', currentGame.getGameState());
      currentGame.broadcastGameState();
      
    }else{
      socket.emit('START_GAME_FAILED', {
      message: 'At least 3 players are required to start the game.'
    });
    }
  });

  socket.on('TOGGLE_READY', () => {
    const success = currentGame.toggleReady(socket.id);

    if (!success) {
      socket.emit('READY_FAILED', { message: 'Cannot change ready state right now.' });
      return;
    }

    currentGame.broadcastGameState();
  });

  socket.on('GET_GAME_STATE', () => {
    socket.emit('GAME_STATE_UPDATE', currentGame.getGameState());
  });

  socket.on('MOVE', ({ targetLoc }) => {
      const success = currentGame.playerMove(socket.id, targetLoc);

      if (!success) {
          socket.emit('MOVE_FAILED', { message: 'Invalid move.' });
      }
  });

  socket.on('SUGGESTION', ({ suspect, weapon }) => {
    currentGame.makeSuggestion(socket.id, suspect, weapon);
  });

  socket.on('DISPROVE', ({ cardShown }) => {
    const success = currentGame.respondToSuggestion(socket.id, cardShown);

    if (!success) {
      socket.emit('SUGGESTION_STATUS', {
        message: 'Invalid disprove response.'
      });
    }
  });
  socket.on('ACCUSATION', ({ suspect, weapon, room }) => {
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
    const hand = currentGame.getPrivateHand(socket.id);
    socket.emit('YOUR_HAND', hand);
  });

  socket.on('END_TURN', () => {
    const success = currentGame.endTurn(socket.id);

    if (!success) {
      socket.emit('END_TURN_FAILED', { message: 'Cannot end turn.' });
    }
  });



  // Optional: 
  
  const characterColors = {
  "Miss Scarlet": "#ff0000",
  "Col. Mustard": "#ffff00",
  "Mrs. White": "#ffffff",
  "Mr. Green": "#39ff14",
  "Mrs. Peacock": "#00bfff",
  "Prof. Plum": "#9b30ff"
  };


  socket.on("CHAT", ({ message }) => {
    if (!message || !message.trim()) return;

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

    io.emit("CHAT", chatMessage);
  });

});

server.listen(PORT, () => {
    console.log(`Clue-less Server running on port ${PORT}`);
});