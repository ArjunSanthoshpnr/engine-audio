import { Engine } from "./Engine";
import { clamp } from "./util/clamp";

export class Drivetrain {
  gear = 0;
  clutch = 1.0;
  downShift = false;

  // Bugatti Chiron 7-speed DSG ratios
  gears = [3.13, 2.15, 1.52, 1.16, 0.9, 0.76, 0.64];
  final_drive = 3.15;

  theta: number = 0;
  omega: number = 0;
  prevTheta: number = 0;
  prevOmega: number = 0;

  theta_wheel: number = 0;
  omega_wheel: number = 0;

  /* Inertia of geartrain + drive shaft [kg m2] */
  inertia = 0.1 + 0.05; /* 0.5 * MR^2 */
  damping = 12;
  compliance = 0.01;

  shiftTime = 50;

  constructor() {
    this.init();
  }

  init(config?: Partial<Drivetrain>) {
    if (config) Object.assign(this, config);

    this.theta = 0;
    this.omega = 0;
    this.prevTheta = 0;
    this.prevOmega = 0;
    this.theta_wheel = 0;
    this.omega_wheel = 0;

    this.gear = 0;
  }

  integrate(dt: number) {
    this.clutch = clamp(this.clutch, 0, 1);

    this.prevTheta = this.theta;
    this.theta += this.omega * dt;
  }

  update(h: number) {
    this.prevOmega = this.omega;

    const dTheta = (this.theta - this.prevTheta) / h;

    this.omega = dTheta;
  }

  solvePos(engine: Engine, h: number) {
    // Positional constraints are disabled. 
    // They cause massive infinite forces when re-engaging the clutch 
    // because of accumulated theta differences during coasting.
    // We now rely purely on solveVel.
  }

  solveVel(engine: Engine, load_inertia: number, h: number) {
    // Handled simultaneously by Engine.solveVel to conserve momentum perfectly!
  }

  getCorrection(corr: number, h: number, compliance = 0) {
    const w = (corr * corr * 1) / this.inertia; // idk?

    const dlambda = -corr / (w + compliance / h / h);

    return corr * -dlambda;
  }

  getFinalDriveRatio() {
    return this.final_drive;
  }

  getGearRatio(gear?: number) {
    gear = gear ?? this.gear;

    gear = clamp(gear, 0, this.gears.length);

    const ratio = gear > 0 ? this.gears[gear - 1] : 0;

    return ratio;
  }

  getTotalGearRatio() {
    return this.getGearRatio() * this.getFinalDriveRatio();
  }

  shifting = false;

  changeGear(gear: number) {
    const prevRatio = this.getGearRatio(this.gear);
    const nextRatio = this.getGearRatio(gear);
    const ratioRatio = prevRatio > 0 ? nextRatio / prevRatio : 0;

    if (ratioRatio === 1) return;

    /* Neutral */
    this.gear = 0;
    this.shifting = true;

    if (ratioRatio > 1) this.downShift = true;

    /* Engage next gear */
    setTimeout(() => {
      this.omega = this.omega * ratioRatio;

      this.gear = gear;
      this.gear = clamp(gear, 0, this.gears.length);
      this.downShift = false;
      this.shifting = false;

      console.log("Changed", this.gear);
    }, this.shiftTime);
  }

  nextGear() {
    this.changeGear(this.gear + 1);
  }

  prevGear() {
    this.changeGear(this.gear - 1);
  }
}
