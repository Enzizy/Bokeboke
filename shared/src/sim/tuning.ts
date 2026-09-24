/** Gameplay feel numbers. Tweaked by play-testing; kept in one place so the server uses the same values. */
export const PHYSICS = {
  /** Simulation rate in Hz. The render loop may run faster or slower; the sim never does. */
  stepHz: 60,
  /** Cap on catch-up steps per frame so a background tab doesn't explode on refocus. */
  maxStepsPerFrame: 5,
  gravity: -14, // a bit stronger than earth so jumps feel snappy and toy-like
} as const;

export const PLAYER = {
  /** Capsule: total height = 2 * (halfHeight + radius) = 0.72, matching the character models. */
  capsuleHalfHeight: 0.16,
  capsuleRadius: 0.2,
  mass: 1,
  walkSpeed: 2.4,
  runSpeed: 4.2,
  groundAccel: 30,
  airAccel: 8,
  /** Initial upward velocity of a jump. ~0.75 units high under our gravity - clears a block. */
  jumpSpeed: 4.6,
  /**
   * Seconds before another jump is allowed, and the upward speed above which you count as
   * already airborne. Together they stop a mashed key from chaining jumps - standing on
   * someone's head used to let you climb out of the arena.
   */
  jumpCooldown: 0.25,
  jumpRiseTolerance: 0.5,
  /** How fast the character turns to face its movement direction, radians per second. */
  turnSpeed: 14,
  /**
   * Sprinting runs on stamina, because otherwise nobody ever walks. A full bar buys about
   * three seconds of running - enough to close a gap or get out of one, not enough to live
   * at running speed - and refills in about five once you ease off.
   */
  staminaMax: 100,
  staminaDrain: 32,
  staminaRegen: 20,
  /** A beat after you stop sprinting before it starts coming back. */
  staminaRegenDelay: 0.5,
  /**
   * Run the bar dry and you are winded: no sprinting again until it has recovered this far.
   * Without it you could stutter-sprint on fumes and never really slow down.
   */
  staminaSprintFloor: 25,
  /** Ground probe: a small ball cast downward from the capsule centre. */
  groundProbeRadius: 0.16,
  groundProbeDistance: 0.26,
  /**
   * How upward a surface has to be before it counts as ground (1 = flat floor, 0 = vertical
   * wall). Without this, hugging a wall let the probe catch its side, and a mashed jump key
   * ratcheted players up it and over the arena border.
   */
  groundNormalMin: 0.5,
  /**
   * The tallest ledge you can walk up without jumping. A capsule driven by velocity stops dead
   * against even a 12 cm step, which made every staircase in the game scenery; this carries
   * players up stairs and kerbs. Kept below the 0.4 arena border so it is still a barrier.
   */
  stepHeight: 0.3,
  /** Seconds of lost control after being hit, so shoves actually move you. */
  staggerTime: 0.35,
  /**
   * How quickly a shoved player scrubs off speed on the ground, per second. Nothing steers
   * the body while you are staggered, and Rapier's friction barely touches a capsule sliding
   * on its end, so without this a mace hit sent people skating a fifth of the way across the
   * arena. Applied to horizontal speed only: a hit that launches you should still arc.
   */
  staggerDrag: 5,
} as const;

export const HEALTH = {
  /** Starting (and maximum) health. Refilled at the start of every round. */
  max: 100,
  /** Seconds a knocked-out player tumbles before they are counted out of the round. */
  koDelay: 1.3,
  /**
   * Health comes back once you have been left alone this long, at this many points a second.
   * Retreating is a real option, so hits hurt more than they used to without every fight
   * becoming a slow war of attrition.
   */
  regenDelay: 5,
  regenRate: 12,
  /**
   * Seconds a player who has just respawned in a timed match cannot be hurt or grabbed, so
   * nobody can wait on a spawn point for free kills. Throwing a punch, kick or grab ends it.
   */
  spawnShield: 1.5,
} as const;

export const GRAB = {
  /** Hit sphere for a grab attempt: this far in front of the chest, this radius. */
  reach: 0.4,
  radius: 0.36,
  /** Held things are carried overhead: this far forward of the grabber, this gap above their head. */
  holdForward: 0.08,
  holdGap: 0.06,
  /** Velocity spring: held body velocity = grabber velocity + offset * spring, capped. */
  spring: 14,
  maxPullSpeed: 6,
  /** Grabber moves at this fraction of walk speed while holding something. */
  carrySpeedFactor: 0.75,
  /** Held players escape when struggle accumulates to 1; input magnitude adds this much per second. */
  escapeRate: 0.9,
  /** A hold never lasts longer than this. */
  maxHoldTime: 4,
  cooldownAfterRelease: 0.4,
} as const;

export const THROW = {
  /** Launch speed given to a thrown player, and its upward fraction. */
  playerSpeed: 4.6,
  playerUp: 0.35,
  /** Launch speed for thrown crates (heavier, so slower). */
  crateSpeed: 4,
  crateUp: 0.3,
} as const;

export const RAGDOLL = {
  /** Accumulated knockdown power at which a player falls over. Decays when not being hit. */
  threshold: 1,
  wobbleDecay: 0.3,
/**
   * Minimum time spent on the floor, and the speed below which a downed player may get up.
   * Being floored is meant to be a moment of chaos, not a punishment: about a second from
   * hitting the ground to being back on your feet.
   */
  minDownTime: 0.7,
  settleSpeed: 0.7,
  /** Give-up: get up anyway after this long, even if still rolling. */
  maxDownTime: 1.6,
  /** Getting-up takes this long; input is ignored until it ends. */
  recoverTime: 0.3,
  /** Angular damping and friction while tumbling. */
  angularDamping: 1.2,
  friction: 0.7,
  /**
   * Ground drag while down, per second. Lighter than a stagger - a thrown body should tumble
   * somewhere - but enough that being floored is not a free ride across the arena.
   */
  drag: 2.5,
  /** Random spin added on knockdown so bodies topple instead of sliding upright. */
  topple: 6,
  /** Seconds a fallen player waits before respawning (the round system will gate this later). */
  respawnDelay: 2.5,
} as const;
