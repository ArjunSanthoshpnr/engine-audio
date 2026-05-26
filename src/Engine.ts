import { AudioManager, DynamicAudioNode } from "./AudioManager";
import { Drivetrain } from "./Drivetrain";
import { ratio } from "./util/ratio";

export class Engine {
  /* Base settings */
  idle = 1000;
  limiter = 0;
  soft_limiter = 0;
  rpm = this.idle;

  /* Inertia of engine + clutch and flywheel [kg/m2] */
  inertia = 0.10; /* Hypercar lightweight internals */

  /* Limiter */
  limiter_ms = 0; // Hard cutoff time
  limiter_delay = 100; // Time while feeding throttle back in
  #last_limiter = 0;

  /* Torque curves */
  torque = 1600; // Realistic Bugatti Torque Nm
  engine_braking = 300;
  throttle = 0;
  ignitionCut: boolean = false;

  /* Integration state */
  theta: number = 0;
  alpha: number = 0;
  omega: number = 0;

  prevTheta: number = 0;
  prevOmega: number = 0;
  dTheta: number = 0;

  /* Precalculated values */
  omega_max: number = 0;

  constructor() {
    this.init();
  }

  init(config?: Partial<Engine>) {
    console.log(this.limiter);
    if (config) Object.assign(this, config);
    this.omega_max = (2 * Math.PI * this.limiter) / 60;

    this.soft_limiter = config?.soft_limiter ?? this.limiter * 0.99;

    this.theta = 0;
    this.alpha = 0;
    this.omega = 0;

    this.prevTheta = 0;
    this.prevOmega = 0;
    this.dTheta = 0;
    this.rpm = 0;
  }

  integrate(load_torque: number, time: number, dt: number) {
    /* Limiter */
    if (this.rpm >= this.soft_limiter) {
      const ratio2 = ratio(this.rpm, this.soft_limiter, this.limiter);
      this.throttle *= Math.pow(1 - ratio2, 0.05);
    }
    if (this.rpm >= this.limiter) this.#last_limiter = time;
    if (time - this.#last_limiter >= this.limiter_ms) {
      const t = time - this.#last_limiter;
      const r = ratio(t, 0, this.limiter_delay);
      this.throttle *= r;
    } else {
      this.throttle = 0.0;
    }

    /* Idle adjustment */
    let idleTorque = 0;
    if (this.throttle < 0.1 && this.rpm < this.idle * 1.5) {
      const rIdle = ratio(this.rpm, this.idle * 0.9, this.idle);
      idleTorque = (1 - rIdle) * this.engine_braking * 10;
    }

    /* Torque */
    let t1 = Math.pow(this.throttle, 1.2) * this.torque;
    if (this.ignitionCut) t1 = 0.0;
    
    const t2 = Math.pow(1 - this.throttle, 1.2) * this.engine_braking;
    const torque = t1 - t2 + idleTorque - load_torque;

    /* Integrate */
    const dAlpha = torque / this.inertia;

    this.prevTheta = this.theta;
    this.omega += dAlpha * dt;
    this.theta += this.omega * dt;
    this.dTheta = this.omega * dt;

    // this.omega = clamp(this.omega, 0, this.omega_max);
    this.rpm = (60 * this.omega) / (2 * Math.PI);
  }

  update(h: number) {
    this.prevOmega = this.omega;

    const dTheta = (this.theta - this.prevTheta) / h;

    this.omega = dTheta;
  }

  solvePos(drivetrain: Drivetrain, h: number) {
    // Positional constraints are disabled. 
    // They cause massive infinite forces when re-engaging the clutch 
    // because of accumulated theta differences during coasting.
    // We now rely purely on solveVel.
  }

  solveVel(drivetrain: Drivetrain, load_inertia: number, h: number) {
    let coupling = 1.0;
    if (this.throttle < 0.1 && this.rpm < 1200 && drivetrain.omega < 40) {
        coupling = 0.0; 
    }
    if (drivetrain.gear === 0) coupling = 0.0;

    // Physical impulse constraint
    const w_engine = 1.0 / this.inertia;
    const w_drivetrain = load_inertia > 0 ? 1.0 / load_inertia : 0;
    
    const dv = drivetrain.omega - this.omega;
    let impulse = dv / (w_engine + w_drivetrain);
    
    // DSG slipping clutch logic for launch
    if (coupling > 0.0 && drivetrain.gear === 1 && drivetrain.omega < this.omega && this.rpm < 3000) {
        // Clutch torque increases with RPM above idle
        const max_clutch_torque = Math.max(0, (this.rpm - 800) * 2.0); 
        const max_impulse = max_clutch_torque * h;
        
        if (impulse > max_impulse) impulse = max_impulse;
        if (impulse < -max_impulse) impulse = -max_impulse;
    }

    // Apply impulse to both simultaneously to conserve momentum!
    this.omega += (impulse * w_engine) * coupling;
    drivetrain.omega -= (impulse * w_drivetrain) * coupling;
  }
  getCorrection(corr: number, h: number, compliance = 0) {
    const w = (corr * corr * 1) / this.inertia; // idk?
    const dlambda = -corr / (w + compliance / h / h);
    return corr * -dlambda;
  }

  applySounds(
    samples: Record<string, DynamicAudioNode>,
    gearRatio = 0,
    rpmPitchFactor = 0.2,
  ) {
    const { gain1: high, gain2: low } = AudioManager.crossFade(
      this.rpm,
      3000,
      6500,
    );
    const { gain1: on, gain2: off } = AudioManager.crossFade(
      this.throttle,
      0,
      1,
    );
    const limiterGain = ratio(this.rpm, this.soft_limiter * 0.93, this.limiter);

    const applySample = (
      key: string,
      gain: number,
      applyPitch: boolean = true,
    ) => {
      if (!samples[key]) {
        return;
      }

      if (applyPitch) {
        samples[key].audio.detune.value = this.getRPMPitch(
          samples[key].rpm,
          rpmPitchFactor,
        );
      }

      samples[key].gain.gain.value = gain * samples[key].volume;
    };

    applySample("on_low", on * low);
    applySample("off_low", off * low);
    applySample("on_high", on * high);
    applySample("off_high", off * high);
    applySample("limiter", limiterGain, false);

    /* TRANSMISSION */
    if (samples["tranny_on"] && samples["tranny_off"]) {
      samples["tranny_on"].audio.detune.value =
        this.rpm * gearRatio * 0.05 - 100;
      samples["tranny_on"].gain.gain.value =
        gearRatio > 0 ? on * samples["tranny_on"].volume : 0;

      samples["tranny_off"].audio.detune.value =
        this.rpm * gearRatio * 0.035 - 800;
      samples["tranny_off"].gain.gain.value =
        gearRatio > 0 ? off * samples["tranny_off"].volume : 0;
    }
  }

  getRPMPitch(sampleRPM: number, rpmPitchFactor: number) {
    return (this.rpm - sampleRPM) * rpmPitchFactor;
  }
}
