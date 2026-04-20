/**
 * Destination Manager
 * Coordinates synchronization of active API keys across multiple destinations
 */
class DestinationManager {
  constructor() {
    this.destinations = [];
  }

  /**
   * Register a new destination
   * @param {object} destination Object with syncIfChanged(name, key) method
   */
  register(destination) {
    this.destinations.push(destination);
  }

  /**
   * Synchronize a key across all registered destinations
   * @param {string} name Variable name (e.g. OPENAI_API_KEY)
   * @param {string} key Active API key
   */
  async sync(name, key) {
    if (!name || !key) return;

    const syncPromises = this.destinations.map(dest => {
      try {
        return dest.syncIfChanged(name, key);
      } catch (error) {
        console.error(`[DEST-MGR] Error in destination sync:`, error.message);
        return Promise.resolve();
      }
    });

    await Promise.all(syncPromises);
  }
}

module.exports = new DestinationManager();
