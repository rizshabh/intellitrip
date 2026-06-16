// Skywriting Animation - Shows EVERY TIME on page refresh
console.log('🚀 Skywriting loaded');

document.body.classList.add('intro-active');

setTimeout(() => {
    const canvas = document.getElementById('skywritingCanvas');

    if (canvas) {
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2 - 30;
        const scale = Math.min(canvas.width / 950, canvas.height / 600, 1.8);

        // Create cursive path
        const path = [];
        function addPoint(x, y) {
            path.push({ x: x * scale, y: y * scale });
        }

        // "Intelli Trip" cursive path
        addPoint(-400, -15); addPoint(-398, -10); addPoint(-396, -5);
        addPoint(-394, 0); addPoint(-392, 5); addPoint(-390, 10);
        addPoint(-388, 15); addPoint(-386, 18);
        addPoint(-384, 19); addPoint(-380, 20); addPoint(-375, 20);
        addPoint(-370, 19); addPoint(-365, 17); addPoint(-360, 14);
        addPoint(-355, 10); addPoint(-350, 5); addPoint(-345, 2);
        addPoint(-340, 0); addPoint(-335, 2); addPoint(-330, 6);
        addPoint(-325, 11); addPoint(-320, 16); addPoint(-318, 20);
        addPoint(-315, 20); addPoint(-310, 20); addPoint(-305, 19);
        addPoint(-302, 16); addPoint(-300, 10); addPoint(-298, 0);
        addPoint(-296, -10); addPoint(-294, -18); addPoint(-292, -20);
        addPoint(-290, -10); addPoint(-288, 0); addPoint(-286, 10);
        addPoint(-284, 18); addPoint(-282, 20);
        addPoint(-278, 20); addPoint(-273, 20); addPoint(-268, 19);
        addPoint(-265, 17); addPoint(-260, 14); addPoint(-255, 10);
        addPoint(-250, 8); addPoint(-245, 7); addPoint(-240, 8);
        addPoint(-237, 11); addPoint(-235, 15); addPoint(-237, 18);
        addPoint(-240, 20); addPoint(-243, 20);
        addPoint(-240, 20); addPoint(-235, 20); addPoint(-230, 19);
        addPoint(-228, 15); addPoint(-226, 8); addPoint(-224, 0);
        addPoint(-222, -10); addPoint(-220, -22); addPoint(-218, -28);
        addPoint(-216, -20); addPoint(-214, -8); addPoint(-212, 2);
        addPoint(-210, 12); addPoint(-208, 19);
        addPoint(-205, 20); addPoint(-200, 20); addPoint(-195, 19);
        addPoint(-193, 15); addPoint(-191, 8); addPoint(-189, 0);
        addPoint(-187, -10); addPoint(-185, -22); addPoint(-183, -28);
        addPoint(-181, -20); addPoint(-179, -8); addPoint(-177, 2);
        addPoint(-175, 12); addPoint(-173, 19);
        addPoint(-170, 20); addPoint(-165, 20); addPoint(-160, 19);
        addPoint(-158, 16); addPoint(-156, 10); addPoint(-154, 4);
        addPoint(-152, 0); addPoint(-150, 4); addPoint(-148, 10);
        addPoint(-146, 16); addPoint(-144, 19);
        addPoint(-140, 19); addPoint(-135, 18); addPoint(-130, 17);
        addPoint(-125, 14); addPoint(-120, 8); addPoint(-115, 0);
        addPoint(-110, -10); addPoint(-105, -20); addPoint(-100, -28);
        addPoint(-95, -30); addPoint(-90, -25); addPoint(-85, -15);
        addPoint(-80, -5); addPoint(-75, 5); addPoint(-70, 14);
        addPoint(-68, 20);
        addPoint(-65, 20); addPoint(-60, 20); addPoint(-55, 19);
        addPoint(-52, 17); addPoint(-48, 13); addPoint(-44, 9);
        addPoint(-40, 5); addPoint(-36, 2); addPoint(-32, 3);
        addPoint(-28, 7); addPoint(-24, 12); addPoint(-20, 17);
        addPoint(-18, 20);
        addPoint(-15, 20); addPoint(-10, 20); addPoint(-5, 19);
        addPoint(-3, 16); addPoint(-1, 10); addPoint(1, 4);
        addPoint(3, 0); addPoint(5, 4); addPoint(7, 10);
        addPoint(9, 16); addPoint(11, 19);
        addPoint(14, 20); addPoint(19, 20); addPoint(24, 19);
        addPoint(27, 17); addPoint(30, 13); addPoint(33, 9);
        addPoint(37, 6); addPoint(42, 5); addPoint(47, 6);
        addPoint(51, 9); addPoint(54, 13); addPoint(56, 18);
        addPoint(56, 23); addPoint(54, 27); addPoint(50, 30);
        addPoint(47, 25); addPoint(45, 32); addPoint(43, 42);
        addPoint(41, 52); addPoint(39, 58);

        const smokeParticles = [];

        class Smoke {
            constructor(x, y) {
                this.x = x;
                this.y = y;
                this.size = 5;
            }

            draw() {
                ctx.save();
                ctx.globalAlpha = 1;
                ctx.fillStyle = '#FFD700';
                ctx.shadowBlur = 30;
                ctx.shadowColor = '#FFD700';
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#FFFFFF';
                ctx.shadowBlur = 20;
                ctx.shadowColor = '#FFFF00';
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size * 0.6, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        function drawPlane(x, y, angle) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.fillStyle = '#2C3E50';
            ctx.shadowBlur = 12;
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.beginPath();
            ctx.moveTo(16, 0);
            ctx.lineTo(-6, -4);
            ctx.lineTo(-6, 4);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(2, 0);
            ctx.lineTo(-3, -10);
            ctx.lineTo(-3, 10);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        let currentIndex = 0;
        const totalDuration = 5000;
        const startTime = performance.now();

        function animate(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / totalDuration, 1);

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            smokeParticles.forEach(p => p.draw());

            currentIndex = Math.floor(progress * path.length);

            if (currentIndex < path.length) {
                const point = path[currentIndex];
                const nextPoint = path[Math.min(currentIndex + 1, path.length - 1)];

                for (let i = 0; i < 5; i++) {
                    smokeParticles.push(new Smoke(
                        centerX + point.x + (Math.random() - 0.5),
                        centerY + point.y + (Math.random() - 0.5)
                    ));
                }

                const angle = Math.atan2(nextPoint.y - point.y, nextPoint.x - point.x);
                drawPlane(centerX + point.x, centerY + point.y, angle);
            }

            requestAnimationFrame(animate);
        }

        requestAnimationFrame(animate);
        console.log('✅ Animation started');
    }
}, 100);

// Remove intro after 6 seconds
setTimeout(() => {
    const intro = document.getElementById('introAnimation');
    if (intro) intro.remove();
    document.body.classList.remove('intro-active');
    console.log('✅ Intro complete');
}, 6000);
