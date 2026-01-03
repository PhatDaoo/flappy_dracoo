const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

app.use(express.static('public'));

// --- CẤU HÌNH ĐỘ KHÓ (SERVER) ---
const SERVER_DIFFICULTY = {
    baseSpawnTime: 1600, // Tốc độ ra cột ban đầu (ms)
    timeDecreaseStep: 100, // Mỗi cấp độ giảm thời gian chờ đi 100ms
    minSpawnTime: 900,   // Tốc độ ra cột nhanh nhất có thể (không nhanh hơn mức này)
    milestone: 10        // Cứ 10 điểm là tăng cấp
};

let rooms = {}; 

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // TẠO PHÒNG
    socket.on('create_room', (data) => {
        let roomId = Math.random().toString(36).substring(2, 7).toUpperCase(); 
        rooms[roomId] = {
            players: {},
            gameState: "WAITING",
            spawnTimer: null, // Dùng timeout thay vì interval để linh hoạt thay đổi tốc độ
            currentMaxScore: 0 // Theo dõi điểm cao nhất trong phòng
        };
        joinRoomLogic(socket, roomId, data.name);
        socket.emit('room_created', roomId);
    });

    // VÀO PHÒNG
    socket.on('join_room', (data) => {
        const { roomId, name } = data;
        if (rooms[roomId]) {
            if (Object.keys(rooms[roomId].players).length >= 4) {
                socket.emit('error_message', 'Phòng đã đầy (Max 4)!');
                return;
            }
            if (rooms[roomId].gameState === "PLAYING") {
                socket.emit('error_message', 'Game đang diễn ra, không thể vào!');
                return;
            }
            joinRoomLogic(socket, roomId, name);
        } else {
            socket.emit('error_message', 'Không tìm thấy phòng!');
        }
    });

    function joinRoomLogic(socket, roomId, name) {
        socket.join(roomId);
        rooms[roomId].players[socket.id] = {
            id: socket.id,
            name: name,
            x: 0, y: 0, rotation: 0, score: 0, isDead: false
        };
        io.to(roomId).emit('update_players', rooms[roomId].players);
    }

    // BẮT ĐẦU GAME
    socket.on('start_game_request', (roomId) => {
        if(rooms[roomId]) {
            rooms[roomId].gameState = "PLAYING";
            rooms[roomId].currentMaxScore = 0; // Reset điểm cao nhất
            
            for (let pid in rooms[roomId].players) {
                rooms[roomId].players[pid].isDead = false;
                rooms[roomId].players[pid].score = 0;
            }

            io.to(roomId).emit('game_started');

            // Hủy timer cũ nếu có
            if (rooms[roomId].spawnTimer) clearTimeout(rooms[roomId].spawnTimer);
            
            // Đợi 3s countdown rồi bắt đầu vòng lặp sinh cột
            setTimeout(() => {
                if (rooms[roomId] && rooms[roomId].gameState === "PLAYING") {
                    spawnPipeLoop(roomId);
                }
            }, 3000);
        }
    });

    // HÀM SINH CỘT ĐỆ QUY (Để thay đổi tốc độ linh hoạt)
    function spawnPipeLoop(roomId) {
        if (!rooms[roomId] || rooms[roomId].gameState !== "PLAYING") return;

        // 1. Tính toán cấp độ dựa trên điểm cao nhất hiện tại trong phòng
        let level = Math.floor(rooms[roomId].currentMaxScore / SERVER_DIFFICULTY.milestone);
        
        // 2. Tính thời gian chờ tiếp theo (Càng cấp cao càng nhanh)
        let nextSpawnTime = SERVER_DIFFICULTY.baseSpawnTime - (level * SERVER_DIFFICULTY.timeDecreaseStep);
        if (nextSpawnTime < SERVER_DIFFICULTY.minSpawnTime) nextSpawnTime = SERVER_DIFFICULTY.minSpawnTime;

        // 3. Sinh cột
        let pipeHeight = 512;
        let randomY = 0 - pipeHeight/4 - Math.random()*(pipeHeight/2.5);
        io.to(roomId).emit('spawn_pipe', randomY);

        // 4. Hẹn giờ lần sinh tiếp theo
        rooms[roomId].spawnTimer = setTimeout(() => {
            spawnPipeLoop(roomId);
        }, nextSpawnTime);
    }

    // CẬP NHẬT VỊ TRÍ & ĐIỂM SỐ
    socket.on('update_position', (data) => {
        if (rooms[data.roomId] && rooms[data.roomId].players[socket.id]) {
            let p = rooms[data.roomId].players[socket.id];
            p.y = data.y;
            p.rotation = data.rotation;
            p.score = data.score;
            
            // Cập nhật điểm cao nhất của phòng để tăng độ khó
            if (p.score > rooms[data.roomId].currentMaxScore) {
                rooms[data.roomId].currentMaxScore = p.score;
            }

            socket.to(data.roomId).emit('player_moved', p);
        }
    });

    // XỬ LÝ CHẾT
    socket.on('player_died', (roomId) => {
        if (rooms[roomId] && rooms[roomId].players[socket.id]) {
            rooms[roomId].players[socket.id].isDead = true;
            io.to(roomId).emit('player_status_update', { id: socket.id, isDead: true });

            let allDead = true;
            let ranking = [];
            for (let pid in rooms[roomId].players) {
                if (!rooms[roomId].players[pid].isDead) allDead = false;
                ranking.push(rooms[roomId].players[pid]);
            }

            if (allDead) {
                if(rooms[roomId].spawnTimer) clearTimeout(rooms[roomId].spawnTimer);
                rooms[roomId].gameState = "GAMEOVER";
                ranking.sort((a, b) => b.score - a.score);
                io.to(roomId).emit('show_leaderboard', ranking);
            }
        }
    });

    // NGẮT KẾT NỐI
    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            if (rooms[roomId].players[socket.id]) {
                delete rooms[roomId].players[socket.id];
                io.to(roomId).emit('update_players', rooms[roomId].players);
                if (Object.keys(rooms[roomId].players).length === 0) {
                    if(rooms[roomId].spawnTimer) clearTimeout(rooms[roomId].spawnTimer);
                    delete rooms[roomId];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});