# Test Prompts: Browser Games

Test prompts for evaluating game generation across genres — from pure-config logic games (no engine needed) to GameCanvas-backed arcade and action games. These exercise the GameCanvas component, Phaser/PixiJS integration, state bridge (game ↔ Exepad), asset handling, and the surrounding app infrastructure (menus, leaderboards, auth, save games).

---

## Puzzle & Logic (Pure Config or Lightweight Canvas)

1. "Create a Wordle clone — 6 guesses, color-coded feedback, keyboard input, streak tracking, and a stats modal"
2. "Build a sliding tile puzzle game — 4x4 grid, shuffle on start, move counter, timer, and a best-time leaderboard"
3. "Make a Sudoku game with difficulty levels, pencil marks, hint button, mistake counter, and a completion celebration"
4. "Create a crossword puzzle game — grid with clues panel, highlight active row/column, and a check-answers button"
5. "Build a minesweeper game — beginner/intermediate/expert grid sizes, flag mode, timer, and a high score board"
6. "Make a 2048 game — swipe/arrow key input, score counter, best score tracking, and an undo button"
7. "Create a number puzzle game like Threes — tiles merge on swipe, score tracking, and game over detection"
8. "Build a nonogram (picross) puzzle game with a 10x10 grid, row/column clues, and a completion checker"

## Card Games

9. "Create a solitaire (Klondike) game with drag-and-drop cards, auto-complete, undo, move counter, and a win animation"
10. "Build a memory card matching game — flip two cards at a time, match pairs, track moves and time, with difficulty levels"
11. "Make a blackjack game — player vs dealer, hit/stand/double, chip betting, and a running balance"
12. "Create a poker hand evaluator game — deal 5 cards, let the player swap up to 3, score the final hand"
13. "Build a card matching game for kids — animal cards, 3 grid sizes, star rating based on moves, and a congratulations screen"
14. "Make a UNO-style card game against a simple AI opponent — draw, play, reverse, skip, and wild cards"

## Board Games

15. "Create a chess game with move validation, piece highlighting, check/checkmate detection, and a move history panel"
16. "Build a checkers game with mandatory jumps, king promotion, and a simple AI opponent"
17. "Make a tic-tac-toe game with single player vs AI and two-player local modes, score tracking across rounds"
18. "Create a Connect Four game — drop discs with column hover preview, win detection with highlight, and a rematch button"
19. "Build an Othello/Reversi game with valid move indicators, piece flip animation, and a score display"
20. "Make a Battleship game — ship placement phase, turn-based guessing, hit/miss markers, and a ship status tracker"

## Word Games

21. "Create a hangman game with category selection, letter guessing, animated drawing, and a win/loss streak counter"
22. "Build a word search puzzle generator — random grid with hidden words, highlight found words, and a timer"
23. "Make a typing racer game — sentences appear, type as fast as you can, WPM and accuracy displayed live"
24. "Create a Boggle-style word finder — 4x4 letter grid, drag to form words, score by word length, 3-minute timer"
25. "Build a Scrabble score calculator — tile rack, drag letters onto a board grid, auto-score with multipliers"

## Arcade & Action (GameCanvas / Phaser-backed)

26. "Create a Snake game — arrow key controls, growing snake, food spawning, wall/self collision, score and high score"
27. "Build a Breakout/Arkanoid game — paddle, ball physics, brick grid with colors, power-ups, lives counter, and levels"
28. "Make a Flappy Bird clone — tap to flap, pipe obstacles, score counter, and a game over screen with retry"
29. "Create a Space Invaders game — player ship, alien grid moving down, shooting, lives, score, and wave progression"
30. "Build a Pac-Man style maze game — dot collection, ghost AI, power pellets, lives, score, and level progression"
31. "Make an Asteroids game — ship rotation and thrust, shooting, asteroid splitting, score, and lives"
32. "Create a Pong game with two-player local mode — paddles, ball physics, score to 11, and a serve system"
33. "Build a Tetris game — piece rotation, line clearing, level speed increase, score, next piece preview, and hold piece"
34. "Make a Frogger-style road crossing game — lanes of traffic, safe zones, lives, timer, and level progression"

## Platformer (GameCanvas / Phaser-backed)

35. "Create a simple platformer — character runs and jumps across platforms, collects coins, avoids enemies, 3 levels"
36. "Build an endless runner game — auto-scrolling, jump over obstacles, collect gems, increasing speed, high score"
37. "Make a doodle jump clone — bouncing character, platforms disappear, power-ups, tilt or arrow controls, altitude score"

## Simulation & Strategy

38. "Create a Cookie Clicker-style idle game — click to earn, buy upgrades that auto-generate, prestige reset mechanic"
39. "Build a simple city builder — place buildings on a grid, manage resources (gold, wood, food), population counter"
40. "Make a tower defense game — path-based enemy waves, place tower types on a grid, upgrade towers, wave counter and lives"
41. "Create a farming simulation — plant crops, water them, harvest after timer, sell at market, manage money and inventory"
42. "Build a lemonade stand game — set daily price and supply, random weather affects demand, track profit over 7 days"

## Educational Games

43. "Create a math blaster game — falling equations, type the answer before they reach the bottom, difficulty scales up"
44. "Build a geography quiz map game — click on the correct country when prompted, score and timer"
45. "Make a chemistry element matching game — match element symbols to names, periodic table reference panel, timed rounds"
46. "Create a history timeline game — drag events to the correct position on a timeline, score by accuracy"
47. "Build a spelling bee game — hear a word (text-to-speech), type the spelling, lives system, increasing difficulty"

## Multiplayer / Social

48. "Create a real-time trivia game lobby — players join with a code, host controls rounds, live scoreboard updates"
49. "Build a drawing and guessing game — one player draws on a canvas, others type guesses, rotating turns, point scoring"
50. "Make a turn-based word game for two players — Scrabble-style tile placement, validated dictionary, score tracking"
51. "Create a multiplayer Battleship — two players join a room, take turns guessing, live hit/miss grid for both"

## Game + App Hybrid (Exepad's Unique Strength)

52. "Build a quiz game show app — admin dashboard to manage question banks, player-facing game with buzzer, live scoreboard, and post-game analytics"
53. "Create a classroom game platform — teacher creates games from a dashboard, students play on their devices, teacher sees live progress and scores"
54. "Make a sales team competition app — gamified leaderboard backed by CRM deal data, weekly challenges, badge awards, and an admin panel to configure rules"
55. "Build a fitness challenge app with a mini-game — daily workout logging (data app), a step-counting game with animated character, team leaderboard, and achievement badges"
56. "Create an escape room management app — public booking page (website), room puzzle game (GameCanvas), and a staff dashboard tracking completions, ratings, and revenue"
57. "Build a training platform — course content pages (website), interactive scenario game per module (GameCanvas), quiz assessment, certificate generation, and admin reporting dashboard"

## Retro / Nostalgia

58. "Create a Tamagotchi-style virtual pet — feed, play, sleep actions, mood/hunger/energy stats, pet grows over days"
59. "Build a text adventure game — room descriptions, inventory system, compass navigation, and puzzle-gated progression"
60. "Make a dungeon crawler with ASCII-style grid — explore rooms, fight monsters (turn-based), collect loot, HP/MP bars"
61. "Create a retro-styled space trading game — fly between planets, buy/sell commodities, fuel management, random encounters"

## Stress Tests / Edge Cases

62. "Create a quick-play arcade game — no accounts needed, but save high scores so players can compete"
63. "Build a game with full persistence — save game state to backend, resume where you left off across sessions"
64. "Make a game that works on both desktop (keyboard) and mobile (touch controls) with automatic input detection"
65. "Create a game with accessibility features — keyboard-only playable, screen reader announcements for game events, high contrast mode"
66. "Build a game with sound effects and background music — mute toggle, volume slider in settings, sounds for key actions"