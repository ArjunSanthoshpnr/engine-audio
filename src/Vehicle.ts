import { AudioManager } from "./AudioManager";
import { Engine } from "./Engine";
import { Drivetrain } from "./Drivetrain";
import { EngineConfiguration } from "./configurations";

export class Vehicle {
  audio = new AudioManager();

  engine = new Engine();
  drivetrain = new Drivetrain();

  mass = 1995; // Bugatti mass

  velocity = 0;
  wheel_rpm = 0;
  wheel_omega = 0;
  wheel_radius = 0.35; // Bugatti wheel radius

  async init(configuration: EngineConfiguration) {
    if (this.audio) this.audio.dispose();

    this.engine.init(configuration.engine);
    this.drivetrain.init(configuration.drivetrain);

    this.audio = new AudioManager();

    await this.audio.init(configuration.sounds);
  }

  // https://github.com/markeasting/THREE-XPBD
  // http://www.thecartech.com/subjects/auto_eng/car_performance_formulas.htm
  // https://pressbooks-dev.oer.hawaii.edu/collegephysics/chapter/10-3-dynamics-of-rotational-motion-rotational-inertia/
  update(time: number, dt: number) {
    /* Simulation loop */
    const subSteps = 20;
    const h = dt / subSteps;

    const I = this.getLoadInertia();
    
    // Aerodynamic Drag (Bugatti Chiron: Cd=0.38, A=2.07) and Rolling Resistance
    const v = this.velocity;
    const F_drag = 0.48 * v * v;
    const F_rr = 0.015 * this.mass * 9.81;
    const F_brake = this.brake * this.mass * 9.81 * 1.5; // 1.5G deceleration
    
    let load_torque = (F_drag + F_rr + F_brake) * this.wheel_radius;
    
    if (this.drivetrain.gear > 0) {
        // If v is 0, don't apply brake backwards
        if (v < 0.1 && load_torque > 0 && this.engine.throttle === 0) {
            load_torque = this.engine.torque * 2; // Prevent reversing
            this.velocity = 0;
            this.drivetrain.omega = 0;
            this.engine.omega = 0;
        } else {
            load_torque /= this.drivetrain.getTotalGearRatio();
        }
    } else {
        load_torque = 0; // Engine feels no aero drag if clutch disconnected
        // Apply forces to coasting car directly
        this.velocity -= (F_drag + F_rr + F_brake) / this.mass * dt;
        if (this.velocity < 0) this.velocity = 0;
    }

    for (let i = 0; i < subSteps; i++) {
      this.engine.ignitionCut = this.drivetrain.shifting;
      this.engine.integrate(load_torque, time + dt * i, h);
      this.drivetrain.integrate(h);

      this.engine.solvePos(this.drivetrain, h);
      this.drivetrain.solvePos(this.engine, h);

      this.engine.update(h);
      this.drivetrain.update(h);

      this.engine.solveVel(this.drivetrain, I, h);
      this.drivetrain.solveVel(this.engine, I, h);
    }

    if (this.drivetrain.gear > 0) {
      this.wheel_omega =
        this.drivetrain.omega / this.drivetrain.getTotalGearRatio();
      this.velocity = this.wheel_omega * this.wheel_radius;
    } else {
      this.velocity *= 0.999; // Coasting
    }

    if (this.audio.ctx)
      this.engine.applySounds(this.audio.samples, this.drivetrain.gear);
  }

  getLoadInertia() {
    if (this.drivetrain.gear == 0) return 0;

    const gearRatio = this.drivetrain.getGearRatio();
    const totalGearRatio = this.drivetrain.getTotalGearRatio();

    /* Moment of inertia - I = mr^2 */
    const I_veh = this.mass * Math.pow(this.wheel_radius, 2);
    const I_wheels = 4 * 12.0 * Math.pow(this.wheel_radius, 2);

    /* Adjust inertia for gear ratio */
    const I1 = I_veh / Math.pow(totalGearRatio, 2);
    const I2 = I_wheels / Math.pow(totalGearRatio, 2);
    const I3 = this.drivetrain.inertia / Math.pow(gearRatio, 2);
    const I = (I1 + I2 + I3) * 1.8; // Tuned to perfectly match Bugatti 2.4s 0-100km/h and 13.1s 0-300km/h

    return I;
  }
}
