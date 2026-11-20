[README.md](https://github.com/user-attachments/files/35186143/README.md)
# Clue-Less

**Clue-Less** is an online multiplayer mystery board game that is a simplified version of the classic board game *Clue*. Players take turns exploring a mansion, making suggestions, and using the clues revealed by other players to identify the suspect, weapon, and room behind the mystery.

**[Play Clue-Less online](https://clue-less-proejct.onrender.com/)** · **[View the source code](https://github.com/cjfghd21/Clue-Less-Proejct)**

## Features

- **Online multiplayer:** Play together in a shared game session, with real-time updates.
- **Character selection and ready lobby:** Choose from six characters and indicate when you're ready. A game requires at least three players.
- **Turn-based gameplay:** Move around the mansion, investigate rooms, and make suggestions.
- **Suggestion and disproof:** Other players have the opportunity to disprove a suggestion by revealing a matching card privately.
- **Accusations and win conditions:** Solve the mystery by correctly identifying the suspect, weapon, and room.
- **Elimination:** An incorrect accusation removes a player from active turns, but they can still help disprove suggestions.

## How to Play

1. **Join a game.** Open the [live game](https://clue-less-proejct.onrender.com/) along with your friends.
2. **Choose a character.** Select an available character and mark yourself ready. At least three players must be ready to begin.
3. **Take turns.** Miss Scarlet goes first. On your turn, move your character and, when eligible, make a suggestion to investigate the mystery.
4. **Gather clues.** A suggestion names a suspect, weapon, and room. Players are asked in turn order to disprove it with a matching card, if possible. Use the information you learn to rule out possibilities.
5. **Make an accusation.** When you think you know the solution, accuse a suspect, weapon, and room. A correct accusation wins the game; an incorrect one eliminates you from active play.

**Tip:** Keep track of the cards you have seen and the suggestions other players could or could not disprove.

## Tech Stack

| Component | Technology |
| --- | --- |
| Game client | Unity (WebGL build) |
| Multiplayer server | Node.js |
| Real-time communication | Socket.IO |
| Hosting | Render |

The Unity WebGL client communicates with the Node.js server through a JavaScript/Socket.IO bridge. The server coordinates player connections, the lobby, game turns, suggestions, and accusations, and broadcasts state changes to connected players.

## Running Locally

This project contains a Unity client and a Node.js multiplayer server. To develop or run it locally:

1. Clone the repository:

   ```bash
   git clone https://github.com/cjfghd21/Clue-Less-Proejct.git
   cd Clue-Less-Proejct
   ```

2. Install a compatible version of Node.js and install the server dependencies from the directory containing `package.json`:

   ```bash
   npm install
   ```

3. Start the server using the start script defined in `package.json` (or the server entry point if no start script is provided).
4. For client development, open the Unity project in its compatible Unity Editor version, configure the Socket.IO server endpoint for your local server, and build for WebGL.

> **Note:** The exact server start command, Unity version, and client/server directory paths depend on the current repository layout. Check `package.json` and the Unity project settings before running locally.

## Deployment

The playable version is hosted on **Render**:

**https://clue-less-proejct.onrender.com/**

The multiplayer server needs to be reachable by every client, and the Unity WebGL build needs to point at the deployed server endpoint. If you deploy your own copy, update the relevant connection settings for your hosting environment.


## Project Team

Developed as a collaborative software project by:

- **Cheolhong (Chris) Ahn** — Project organization and development
- **Marcus** — Lead testing and presentation
- **Thavelarn** — UI design and implementation

## Acknowledgment

Inspired by *Clue*, the classic mystery board game. This project is an independent educational adaptation and is not affiliated with or endorsed by Hasbro.
