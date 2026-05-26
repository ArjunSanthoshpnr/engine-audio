import * as dat from 'dat.gui';
import * as configurations from './configurations';
import { Vehicle } from './Vehicle';
import { clamp } from './util/clamp';

let loaded = false;

const settings = {
    activeConfig: 'bac_mono'
}

/* Vehicle */
const vehicle = new Vehicle();
const engine = vehicle.engine;
const drivetrain = vehicle.drivetrain;

/* GUI */
const gui = new dat.GUI();

const guiMain = gui.addFolder('Settings');
const guiEngine = gui.addFolder('Engine');
const guiDrivetrain = gui.addFolder('Drivetrain');

guiMain.open();
guiEngine.open();
guiDrivetrain.open();

guiMain.add(settings, 'activeConfig', Object.keys(configurations)).name('Select config');

guiEngine.add(engine, 'throttle', 0, 1).name('Throttle').listen();
guiEngine.add(engine, 'rpm', 0, engine.limiter).name('RPM').listen();
guiEngine.add(engine, 'theta', 0, 1000).name('Theta').listen();
guiEngine.add(engine, 'omega', -100, 100).name('Omega').listen();

guiDrivetrain.add(drivetrain, 'gear').name('Gear').listen();
guiDrivetrain.add(drivetrain, 'theta', 0, 1000).name('Theta').listen();
guiDrivetrain.add(drivetrain, 'omega', -100, 100).name('Omega').listen();

/* Events */
const keys: Record<string, boolean> = {}

document.addEventListener('keydown', e => {
    keys[e.code] = true;
});

document.addEventListener('keyup', e => {
    if (!loaded) {
        return;
    }
    
    keys[e.code] = false;

    if (e.code.startsWith('Digit')) {
        const nextGear = +e.key;
        drivetrain.changeGear(nextGear);
    }

    if (e.code == 'ArrowUp')
        drivetrain.nextGear();
    if (e.code == 'ArrowDown')
        drivetrain.prevGear();
});

/* Initialization */
const startBtn = document.getElementById('start_btn');
const controls = document.getElementById('controls');

startBtn?.addEventListener('click', start, {once : true})
document.querySelector('select')?.addEventListener('change', start)

async function start() {
    // @ts-ignore
    await vehicle.init(configurations[settings.activeConfig]);

    loaded = true;
    
    startBtn!.style.display = 'none';
    controls!.style.display = 'block';
    
    const dashboard = document.getElementById('dashboard');
    if (dashboard) dashboard.style.display = 'flex';
}

/* Update loop */
let 
    lastTime = (new Date()).getTime(),
    currentTime = 0,
    dt = 0;
    
function update(time: DOMHighResTimeStamp): void {

    requestAnimationFrame(time => {
        update(time);
    });
    
    currentTime = (new Date()).getTime();
    dt = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    if (dt === 0) {
        return;
    }

    if (!loaded) {
        return;
    }

    let gas = 0;
    let brake = 0;

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
            pad = gamepads[i];
            break;
        }
    }

    if (pad) {
        // Read triggers. Try standard buttons first.
        const gasBtn = pad.buttons[7]?.value || 0;
        const brakeBtn = pad.buttons[6]?.value || 0;
        const gasAxis = (pad.axes.length > 5) ? pad.axes[5] : -1;
        const brakeAxis = (pad.axes.length > 2) ? pad.axes[2] : -1;

        gas = gasBtn;
        brake = brakeBtn;
        
        // Some drivers map triggers to axes instead of buttons
        // Usually Axis 5 is RT, Axis 2 is LT, ranging from -1 to 1
        if (gas === 0 && gasAxis > -0.9) {
            gas = (gasAxis + 1) / 2;
        }
        if (brake === 0 && brakeAxis > -0.9) {
            brake = (brakeAxis + 1) / 2;
        }

        // Output gamepad status to screen
        const debugEl = document.getElementById('gamepad_debug');
        if (debugEl) {
            debugEl.innerText = `Gamepad Active! [${pad.id}]\nGas: ${gas.toFixed(2)} (Btn7: ${gasBtn.toFixed(2)}, Axis5: ${gasAxis.toFixed(2)})\nBrake: ${brake.toFixed(2)} (Btn6: ${brakeBtn.toFixed(2)}, Axis2: ${brakeAxis.toFixed(2)})`;
        }

        // Handle shifting with bumpers (Button 5 = RB/Upshift, Button 4 = LB/Downshift)
        const rbPressed = pad.buttons[5]?.pressed || false;
        const lbPressed = pad.buttons[4]?.pressed || false;
        
        if (rbPressed && !(window as any)._prevRb) {
            drivetrain.nextGear();
        }
        if (lbPressed && !(window as any)._prevLb) {
            drivetrain.prevGear();
        }
        (window as any)._prevRb = rbPressed;
        (window as any)._prevLb = lbPressed;
    } else {
        const debugEl = document.getElementById('gamepad_debug');
        if (debugEl && !(window as any)._gamepadErrorMsg) {
            debugEl.innerText = "No gamepad detected. Press any button to wake it up.";
        }
    }

    if (!(window as any)._gamepadListenersAdded) {
        window.addEventListener("gamepadconnected", (e) => {
            console.log("Gamepad connected at index %d: %s. %d buttons, %d axes.",
                e.gamepad.index, e.gamepad.id,
                e.gamepad.buttons.length, e.gamepad.axes.length);
            (window as any)._gamepadErrorMsg = false;
        });
        window.addEventListener("gamepaddisconnected", (e) => {
            console.log("Gamepad disconnected from index %d: %s",
                e.gamepad.index, e.gamepad.id);
        });
        (window as any)._gamepadListenersAdded = true;
    }

    // Keyboard fallback if gamepad not pressed
    if (gas === 0 && brake === 0) {
        if (keys['Space']) gas = 1;
        if (keys['KeyB']) brake = 1;
    }

    if (drivetrain.downShift) {
        engine.throttle = 0.8; // Rev matching
    } else {
        // Smooth keyboard inputs, but allow direct dynamic input from gamepad
        if (pad && (gas > 0 || brake > 0)) {
            engine.throttle = gas;
        } else {
            if (gas > 0) {
                engine.throttle = clamp(engine.throttle + 0.4, 0, 1);
            } else {
                engine.throttle = clamp(engine.throttle - 0.4, 0, 1);
            }
        }
    }

    vehicle.brake = brake;
    
    vehicle.update(time, dt);

    // Update Dashboard UI
    const rpm = engine.rpm;
    // 0 RPM = -135deg, 10000 RPM = +135deg -> range 270 deg
    const rpmRotation = clamp(-135 + (rpm / 10000) * 270, -135, 140);
    const rpmNeedle = document.getElementById('rpm_needle');
    if (rpmNeedle) rpmNeedle.style.transform = `rotate(${rpmRotation}deg)`;

    const rpmReadout = document.getElementById('rpm_readout');
    if (rpmReadout) rpmReadout.innerText = `${Math.floor(rpm)} RPM`;

    // Velocity m/s to km/h
    const speed = Math.max(0, vehicle.velocity * 3.6);
    // 0 km/h = -135deg, 500 km/h = +135deg -> range 270 deg
    const speedRotation = clamp(-135 + (speed / 500) * 270, -135, 140);
    const speedNeedle = document.getElementById('speed_needle');
    if (speedNeedle) speedNeedle.style.transform = `rotate(${speedRotation}deg)`;

    const speedReadout = document.getElementById('speed_readout');
    if (speedReadout) speedReadout.innerText = `${Math.floor(speed)} km/h`;

    const gearDisplay = document.getElementById('gear_display');
    if (gearDisplay) gearDisplay.innerText = drivetrain.gear === 0 ? 'N' : drivetrain.gear.toString();
}

update(10);
