// --- VARIABLES ---
let socket;

// !!! QUAN TRỌNG: THAY LINK RENDER CỦA BẠN VÀO ĐÂY !!!
const SERVER_URL = "https://flappy-dracoo.onrender.com"; 
// Nếu chạy local thì dùng: const SERVER_URL = "http://localhost:3000";

let isMultiplayer = false;
let currentRoomId = null;
let myName = "Player";
let remotePlayers = {}; 
let isHost = false; 

// --- CẤU HÌNH ĐỘ KHÓ (CLIENT - DỄ DÀNG CHỈNH SỬA) ---
const GAME_DIFFICULTY = {
    baseSpeed: -3,       // Tốc độ ban đầu
    speedIncrease: -0.5, // Mỗi cấp độ tăng thêm bao nhiêu (số âm)
    milestone: 10,       // Bao nhiêu điểm thì tăng cấp 1 lần
    maxSpeed: -8         // Tốc độ tối đa (không nhanh hơn mức này)
};

// Board
let board;
let boardWidth = 360; 
let boardHeight = 640;
let context;

// Draco (90x90)
let dracoWidth = 90;
let dracoHeight = 90;
let dracoX = boardWidth / 8;
let dracoY = boardHeight / 2;
let draco = { x: dracoX, y: dracoY, width: dracoWidth, height: dracoHeight, rotation: 0 };

// Assets
let dracoImg1 = new Image(); 
let dracoImg2 = new Image(); 
let currentDracoSprite; 
let wingFlapSpeed = 25; 

// Physics
// velocityX bây giờ sẽ biến thiên, không cố định
let velocityY = 0; 
let gravity = 0.25; 
let jumpStrength = -6; 

// Pipes
let pipeArray = [];
let pipeWidth = 64;
let pipeHeight = 512;
let pipeX = boardWidth; 
let pipeGap = boardHeight / 3.2; 

// State
let score = 0;
let highScore = localStorage.getItem('flappyHighScore') || 0;
let frameCount = 0; 
let lastTime = 0;
let accumulator = 0;
const TIME_STEP = 1000 / 60; 
let gameState = "MENU"; 
let countdownValue = 3;

// DOM Elements
const uiLayer = document.getElementById('ui-layer');
const mainMenu = document.getElementById('main-menu');
const multiMenu = document.getElementById('multiplayer-menu');
const lobbyScreen = document.getElementById('lobby-screen');
const leaderboardScreen = document.getElementById('leaderboard-screen'); 
const singleGameoverScreen = document.getElementById('single-gameover-screen'); 
const spCurrentScore = document.getElementById('sp-current-score'); 
const spBestScore = document.getElementById('sp-best-score'); 
const errorMsg = document.getElementById('error-message');
const highScoreDisplay = document.getElementById('high-score-display');
const loadingScreen = document.getElementById('loading-overlay');

const MIN_INTRO_TIME = 7000; 

// --- INIT ---
window.onload = function() {
    const loadStartTime = Date.now();

    board = document.getElementById("board");
    board.height = boardHeight; 
    board.width = boardWidth;
    context = board.getContext("2d"); 

    dracoImg1.src = 'dd.png'; 
    dracoImg2.src = 'cc.png';
    currentDracoSprite = dracoImg1;

    highScoreDisplay.innerText = "Best Score: " + Math.floor(highScore);
    
    socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
    
    socket.on("connect", () => {
        console.log("Connected to Server!");
        const elapsedTime = Date.now() - loadStartTime;
        const remainingTime = MIN_INTRO_TIME - elapsedTime;

        if (remainingTime > 0) {
            setTimeout(() => { if(loadingScreen) loadingScreen.classList.add('hidden'); }, remainingTime);
        } else {
            if(loadingScreen) loadingScreen.classList.add('hidden');
        }
    });

    socket.on("connect_error", () => {
        if(loadingScreen) loadingScreen.classList.remove('hidden');
    });

    setupSocketEvents();
    requestAnimationFrame(gameLoop);
    
    document.addEventListener("keydown", handleInput);
    board.addEventListener("mousedown", handleInputMouse); 
    board.addEventListener("touchstart", handleInputTouch, {passive: false});
}

// --- MENU FUNCTIONS ---
function getPlayerName() {
    let inputName = document.getElementById('player-name').value;
    return inputName.trim() !== "" ? inputName : "Dragon " + Math.floor(Math.random()*100);
}
function startSinglePlayer() {
    isMultiplayer = false; myName = getPlayerName(); mainMenu.classList.add('hidden');
    resetGame(); gameState = "START_SINGLE"; 
}
function restartSinglePlayer() {
    singleGameoverScreen.classList.add('hidden'); 
    resetGame(); gameState = "START_SINGLE";
}
function showMultiplayerMenu() { myName = getPlayerName(); mainMenu.classList.add('hidden'); multiMenu.classList.remove('hidden'); }
function backToMain() {
    if(currentRoomId) { socket.emit('leave_room'); currentRoomId = null; } 
    multiMenu.classList.add('hidden');
    lobbyScreen.classList.add('hidden');
    leaderboardScreen.classList.add('hidden');
    singleGameoverScreen.classList.add('hidden');
    mainMenu.classList.remove('hidden');
    gameState = "MENU"; resetGame();
    highScoreDisplay.innerText = "Best Score: " + Math.floor(highScore);
}
function createRoom() { socket.emit('create_room', { name: myName }); isHost = true; }
function joinRoom() {
    let id = document.getElementById('room-id-input').value.toUpperCase();
    if(id.length < 1) { showError("Please enter Room ID!"); return; }
    socket.emit('join_room', { roomId: id, name: myName }); isHost = false; 
}
function requestStartGame() { if(currentRoomId) socket.emit('start_game_request', currentRoomId); }
function showError(msg) {
    errorMsg.innerText = msg; errorMsg.classList.remove('hidden');
    setTimeout(() => errorMsg.classList.add('hidden'), 3000);
}

// --- SOCKET EVENTS ---
function setupSocketEvents() {
    socket.on('room_created', (roomId) => {
        currentRoomId = roomId; isMultiplayer = true; 
        multiMenu.classList.add('hidden'); lobbyScreen.classList.remove('hidden');
        document.getElementById('room-id-display').innerText = roomId;
        document.getElementById('start-multi-btn').classList.remove('hidden');
        document.getElementById('lobby-status').innerText = "Host waiting...";
    });

    socket.on('update_players', (players) => {
        if(gameState === "MENU" || !lobbyScreen.classList.contains('hidden')) {
            currentRoomId = currentRoomId || document.getElementById('room-id-input').value.toUpperCase();
            isMultiplayer = true; multiMenu.classList.add('hidden'); lobbyScreen.classList.remove('hidden');
            document.getElementById('room-id-display').innerText = currentRoomId;
            let listHTML = "";
            Object.values(players).forEach(p => {
                listHTML += `<div style="padding:5px; border-bottom:1px solid #eee;">${p.name} ${p.id === socket.id ? "<b>(You)</b>" : ""} ${p.isDead ? "💀" : "Ready"}</div>`;
            });
            document.getElementById('player-list').innerHTML = listHTML;
        }
        
        Object.keys(players).forEach(id => {
            if(id !== socket.id) {
                if (!remotePlayers[id]) {
                    remotePlayers[id] = players[id];
                    remotePlayers[id].targetY = players[id].y;
                    remotePlayers[id].targetRotation = players[id].rotation;
                }
            }
        });
        for (let id in remotePlayers) if (!players[id]) delete remotePlayers[id];
    });

    socket.on('game_started', () => {
        lobbyScreen.classList.add('hidden'); leaderboardScreen.classList.add('hidden'); 
        resetGame(); startCountdown();
    });

    socket.on('spawn_pipe', (serverPipeY) => {
        if (gameState === "PLAYING" || gameState === "GAMEOVER_SPECTATING") placePipesFromServer(serverPipeY);
    });

    socket.on('player_moved', (p) => {
        if(remotePlayers[p.id]) { 
            remotePlayers[p.id].targetY = p.y; 
            remotePlayers[p.id].targetRotation = p.rotation; 
            remotePlayers[p.id].isDead = p.isDead; 
            remotePlayers[p.id].score = p.score;
        } else { 
            remotePlayers[p.id] = p; 
            remotePlayers[p.id].targetY = p.y;
            remotePlayers[p.id].targetRotation = p.rotation;
        }
    });

    socket.on('show_leaderboard', (ranking) => {
        gameState = "LEADERBOARD"; 
        let tbody = document.getElementById('score-body'); tbody.innerHTML = "";
        ranking.forEach((player, index) => {
            let row = `<tr><td>#${index + 1}</td><td>${player.name}</td><td>${Math.floor(player.score)}</td></tr>`;
            tbody.innerHTML += row;
        });
        leaderboardScreen.classList.remove('hidden');
        if(isHost) {
            document.getElementById('host-controls').classList.remove('hidden');
            document.getElementById('guest-controls').classList.add('hidden');
        } else {
            document.getElementById('host-controls').classList.add('hidden');
            document.getElementById('guest-controls').classList.remove('hidden');
        }
    });
    socket.on('error_message', (msg) => showError(msg));
}

// --- GAME LOOP ---
function startCountdown() {
    gameState = "COUNTDOWN"; countdownValue = 3;
    let timer = setInterval(() => {
        countdownValue--;
        if (countdownValue <= 0) {
            clearInterval(timer); gameState = "PLAYING";
            lastTime = performance.now(); accumulator = 0;
            if (!isMultiplayer) singlePlayerPipeTimer = 0;
        }
    }, 1000);
}

let singlePlayerPipeTimer = 0;

function gameLoop(timestamp) {
    requestAnimationFrame(gameLoop);
    if (!lastTime) lastTime = timestamp;
    let deltaTime = timestamp - lastTime; lastTime = timestamp;
    if (deltaTime > 1000) deltaTime = 1000;
    accumulator += deltaTime;
    while (accumulator >= TIME_STEP) { updatePhysics(); accumulator -= TIME_STEP; }
    
    if (isMultiplayer) {
        let smoothFactor = 0.15; 
        Object.keys(remotePlayers).forEach(key => {
            let p = remotePlayers[key];
            if (p.targetY !== undefined) {
                p.y = p.y + (p.targetY - p.y) * smoothFactor;
                p.rotation = p.rotation + (p.targetRotation - p.rotation) * smoothFactor;
            }
        });
    }
    draw();
}

function updatePhysics() {
    if(gameState === "MENU" || gameState === "LEADERBOARD" || gameState === "GAMEOVER") return;

    if (gameState === "PLAYING" || gameState === "GAMEOVER_SPECTATING") {
        
        // 1. TÍNH TOÁN TỐC ĐỘ HIỆN TẠI (Progression)
        let speedLevel = Math.floor(score / GAME_DIFFICULTY.milestone);
        // Tốc độ = Base + (Level * Tăng thêm) -> Ví dụ: -3 + (2 * -0.5) = -4
        let currentSpeed = GAME_DIFFICULTY.baseSpeed + (speedLevel * GAME_DIFFICULTY.speedIncrease);
        // Giới hạn không cho quá nhanh
        if (currentSpeed < GAME_DIFFICULTY.maxSpeed) currentSpeed = GAME_DIFFICULTY.maxSpeed;

        if (!isMultiplayer && gameState === "PLAYING") {
            singlePlayerPipeTimer += TIME_STEP;
            // Ở Single Player, cũng cần giảm thời gian sinh cột để khớp với tốc độ
            // BaseSpawnTime 1600, cứ mỗi level giảm 100ms
            let spawnTime = 1600 - (speedLevel * 100);
            if (spawnTime < 900) spawnTime = 900;

            if (singlePlayerPipeTimer > spawnTime) { placePipesLocal(); singlePlayerPipeTimer = 0; }
        }
        
        for (let i = 0; i < pipeArray.length; i++) {
            let pipe = pipeArray[i];
            
            // Dùng currentSpeed thay vì velocityX tĩnh
            pipe.x += currentSpeed; 
            
            if (gameState === "PLAYING") {
                if (!pipe.passed && draco.x > pipe.x + pipe.width) { score += 0.5; pipe.passed = true; }
                if (detectCollision(draco, pipe)) handleGameOver();
            }
        }
        while (pipeArray.length > 0 && pipeArray[0].x < -pipeWidth * 2) pipeArray.shift();
    }

    if (gameState === "PLAYING") {
        frameCount++; velocityY += gravity; 
        draco.y += velocityY; draco.y = Math.max(draco.y, 0);
        draco.rotation = Math.min(Math.max(velocityY * 0.05, -0.5), 1.2);
        if (draco.y + draco.height > board.height) handleGameOver();
        if(isMultiplayer) socket.emit('update_position', { roomId: currentRoomId, y: draco.y, rotation: draco.rotation, score: score });
    } else if (gameState.includes("START") || gameState === "COUNTDOWN") {
        frameCount++; draco.y = dracoY + Math.sin(frameCount * 0.05) * 10; draco.rotation = 0;
    }
}

function draw() {
    context.clearRect(0, 0, board.width, board.height);
    if(gameState === "MENU") return;

    if (isMultiplayer) {
        Object.keys(remotePlayers).forEach(key => {
            let p = remotePlayers[key];
            if(!p.isDead) { 
                let ghostDraco = { x: dracoX, y: p.y, width: dracoWidth, height: dracoHeight, rotation: p.rotation };
                drawDracoSprite(ghostDraco, 0.5); 
                context.fillStyle = "rgba(255, 255, 255, 0.8)"; context.font = "bold 14px Arial"; context.textAlign = "center";
                context.fillText(p.name, dracoX + dracoWidth/2, p.y - 5);
            }
        });
    }

    for (let i = 0; i < pipeArray.length; i++) {
        let pipe = pipeArray[i];
        let gradient = context.createLinearGradient(pipe.x, 0, pipe.x + pipeWidth, 0);
        gradient.addColorStop(0, '#2ecccc'); gradient.addColorStop(1, '#277fae'); 
        context.fillStyle = gradient;
        context.fillRect(Math.floor(pipe.x), Math.floor(pipe.y), pipe.width, pipe.height);
        context.strokeStyle = "#1a5276"; context.lineWidth = 2;
        context.strokeRect(Math.floor(pipe.x), Math.floor(pipe.y), pipe.width, pipe.height);
    }

    if(gameState !== "GAMEOVER_SPECTATING") {
        if (frameCount % (wingFlapSpeed * 2) < wingFlapSpeed) currentDracoSprite = dracoImg1;
        else currentDracoSprite = dracoImg2;
        drawDracoSprite(draco, 1.0);
    }

    if (gameState !== "LEADERBOARD" && gameState !== "GAMEOVER") drawScore(); 
    
    if (gameState === "START_SINGLE") drawTextCenter("TAP TO START", 40);
    else if (gameState === "COUNTDOWN") drawTextCenter(countdownValue > 0 ? countdownValue : "GO!", 100, "#f1c40f");
    else if (gameState === "GAMEOVER_SPECTATING") {
        context.fillStyle = "rgba(0,0,0,0.3)"; context.font = "bold 25px Arial";
        context.fillStyle = "#f39c12"; context.textAlign = "center";
        context.fillText("Spectating...", boardWidth/2, boardHeight/2);
    }
}

// --- HELPER ---
function placePipesFromServer(y) {
    pipeArray.push({ x: pipeX, y: y, width: pipeWidth, height: pipeHeight, passed: false });
    pipeArray.push({ x: pipeX, y: y + pipeHeight + pipeGap, width: pipeWidth, height: pipeHeight, passed: false });
}
function placePipesLocal() {
    let randomY = 0 - pipeHeight/4 - Math.random()*(pipeHeight/2.5);
    placePipesFromServer(randomY);
}
function handleGameOver() {
    if (score > highScore) { highScore = score; localStorage.setItem('flappyHighScore', highScore); }
    if(isMultiplayer) { gameState = "GAMEOVER_SPECTATING"; socket.emit('player_died', currentRoomId); } 
    else { 
        gameState = "GAMEOVER"; 
        spCurrentScore.innerText = Math.floor(score);
        spBestScore.innerText = Math.floor(highScore);
        singleGameoverScreen.classList.remove('hidden');
    }
}
function drawDracoSprite(target, alpha) {
    context.save(); context.globalAlpha = alpha;
    context.translate(target.x + target.width/2, target.y + target.height/2);
    context.rotate(target.rotation);
    if (currentDracoSprite.complete) context.drawImage(currentDracoSprite, -target.width/2, -target.height/2, target.width, target.height);
    context.restore();
}
function drawTextCenter(text, size, color="white") {
    context.fillStyle = color; context.strokeStyle = "black"; context.lineWidth = 4;
    context.font = `bolder ${size}px 'Courier New'`; context.textAlign = "center";
    context.strokeText(text, boardWidth/2, boardHeight/2); context.fillText(text, boardWidth/2, boardHeight/2);
}
function drawScore() {
    context.fillStyle = "white"; context.strokeStyle = "black"; context.lineWidth = 2; context.textAlign = "left"; 
    context.font = "bolder 40px 'Courier New'"; context.strokeText(Math.floor(score), 15, 50); context.fillText(Math.floor(score), 15, 50);
}
function getMousePos(evt) {
    let rect = board.getBoundingClientRect(); 
    let scaleX = board.width / rect.width; let scaleY = board.height / rect.height;
    let clientX = evt.clientX || (evt.touches ? evt.touches[0].clientX : 0);
    let clientY = evt.clientY || (evt.touches ? evt.touches[0].clientY : 0);
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}
function handleInputMouse(e) { if(gameState === "GAMEOVER") return; let pos = getMousePos(e); checkClick(pos.x, pos.y); }
function handleInputTouch(e) { if(gameState === "GAMEOVER") return; if (e.cancelable) e.preventDefault(); let pos = getMousePos(e); checkClick(pos.x, pos.y); }
function handleInput(e) { if(gameState === "GAMEOVER") return; if (e.code == "Space" || e.code == "ArrowUp") actionJump(); }
function actionJump() {
    if (gameState === "START_SINGLE") startCountdown();
    else if (gameState === "PLAYING") velocityY = jumpStrength; 
}
function checkClick(x, y) { actionJump(); }
function resetGame() {
    draco.y = dracoY; draco.rotation = 0; velocityY = 0;
    pipeArray = []; score = 0; frameCount = 0; 
    accumulator = 0; singlePlayerPipeTimer = 0;
    lastTime = performance.now();
}
function detectCollision(a, b) {
    let p = 8; 
    return a.x + p < b.x + b.width && a.x + a.width - p > b.x && a.y + p < b.y + b.height && a.y + a.height - p > b.y;
}
