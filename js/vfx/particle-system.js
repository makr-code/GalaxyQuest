/**
 * particle-system.js – Visual Effects & Particle Burst System
 * Creates smooth particle bursts for success, error, and interactive feedback
 */

const GQParticles = (() => {
  'use strict';

  const config = {
    particleCount: 8,
    speed: 400,
    gravity: 0.2,
  };

  /**
   * Create particle burst at position
   */
  function burst(x, y, type = 'success', count = config.particleCount) {
    const container = document.createElement('div');
    container.className = 'particle-container';
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '9999';

    document.body.appendChild(container);

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const velocity = config.speed + Math.random() * 200;

      const particle = document.createElement('div');
      particle.className = `particle particle-${type}`;
      particle.style.position = 'fixed';
      particle.style.left = `${x}px`;
      particle.style.top = `${y}px`;
      particle.style.width = '8px';
      particle.style.height = '8px';
      particle.style.borderRadius = '50%';
      particle.style.pointerEvents = 'none';

      // Set particle color based on type
      const colors = {
        success: 'rgba(34, 212, 106, 0.8)',
        error: 'rgba(255, 68, 85, 0.8)',
        info: 'rgba(58, 160, 255, 0.8)',
        warning: 'rgba(255, 204, 0, 0.8)',
      };

      particle.style.background = colors[type] || colors.info;
      particle.style.boxShadow = `0 0 4px ${colors[type]}`;

      container.appendChild(particle);

      // Animate particle
      animateParticle(particle, angle, velocity, config.gravity);
    }

    // Clean up after animation
    setTimeout(() => {
      container.remove();
    }, 1000);
  }

  /**
   * Animate single particle
   */
  function animateParticle(particle, angle, velocity, gravity) {
    let x = 0;
    let y = 0;
    let vx = Math.cos(angle) * velocity;
    let vy = Math.sin(angle) * velocity;
    let opacity = 1;

    const startTime = performance.now();
    const duration = 800;

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Physics simulation
      x += vx;
      y += vy;
      vy += gravity;
      opacity = 1 - progress;

      particle.style.transform = `translate(${x}px, ${y}px)`;
      particle.style.opacity = opacity;

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }

  /**
   * Trigger particle burst on element with animation
   */
  function burstOnElement(element, type = 'success') {
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    burst(x, y, type);
  }

  /**
   * Create success effect with checkmark
   */
  function successEffect(x, y) {
    burst(x, y, 'success', 12);

    // Add checkmark animation
    const checkmark = document.createElement('div');
    checkmark.innerHTML = '✓';
    checkmark.style.position = 'fixed';
    checkmark.style.left = `${x}px`;
    checkmark.style.top = `${y}px`;
    checkmark.style.transform = 'translate(-50%, -50%)';
    checkmark.style.fontSize = '2rem';
    checkmark.style.color = '#22d46a';
    checkmark.style.pointerEvents = 'none';
    checkmark.style.fontWeight = 'bold';
    checkmark.style.textShadow = '0 0 8px rgba(34, 212, 106, 0.8)';
    checkmark.style.animation = 'popoverBounceIn 0.6s ease-out forwards';
    checkmark.style.zIndex = '10000';

    document.body.appendChild(checkmark);

    setTimeout(() => {
      checkmark.style.opacity = '0';
      checkmark.style.transition = 'opacity 0.3s ease-out';
      setTimeout(() => checkmark.remove(), 300);
    }, 400);
  }

  /**
   * Create error effect with X
   */
  function errorEffect(x, y) {
    burst(x, y, 'error', 8);

    // Add error icon animation
    const errorIcon = document.createElement('div');
    errorIcon.innerHTML = '✕';
    errorIcon.style.position = 'fixed';
    errorIcon.style.left = `${x}px`;
    errorIcon.style.top = `${y}px`;
    errorIcon.style.transform = 'translate(-50%, -50%)';
    errorIcon.style.fontSize = '2rem';
    errorIcon.style.color = '#ff4455';
    errorIcon.style.pointerEvents = 'none';
    errorIcon.style.fontWeight = 'bold';
    errorIcon.style.textShadow = '0 0 8px rgba(255, 68, 85, 0.8)';
    errorIcon.style.animation = 'pop 0.6s ease-out forwards';
    errorIcon.style.zIndex = '10000';

    document.body.appendChild(errorIcon);

    setTimeout(() => {
      errorIcon.style.opacity = '0';
      errorIcon.style.transition = 'opacity 0.3s ease-out';
      setTimeout(() => errorIcon.remove(), 300);
    }, 400);
  }

  // Public API
  return {
    burst,
    burstOnElement,
    successEffect,
    errorEffect,
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.GQParticles = GQParticles;
}
