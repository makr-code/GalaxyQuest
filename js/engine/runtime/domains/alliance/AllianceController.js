/**
 * AllianceController - Manages faction alliances and organizations
 * Responsible for: alliance creation, member management, hierarchy, shared economy
 * Uses: EventBus for communication, State.js for management
 */

import State from '../shared/State.js';

export class AllianceController {
  constructor({ eventBus, repository, logger } = {}) {
    this.eventBus = eventBus;
    this.repository = repository;
    this.logger = logger;

    this.state = new State({
      alliances: {}, // { allianceId: { id, name, leader, founded, members: [], treasury, policies } }
      members: {}, // { factionId: { allianceId, rank, joinedAt, contributes } }
      treasury: {}, // { allianceId: { credits: 0, minerals: 0, energy: 0 } }
      policies: {}, // { allianceId: { name, rules, votingThreshold } }
      votes: {}, // { voteId: { allianceId, topic, yesVotes, noVotes, status } }
      totalAlliances: 0,
      isLocked: false,
      lastModified: Date.now(),
      isDirty: false,
    }, {
      totalAlliances: { type: 'number', min: 0 },
      isLocked: { type: 'boolean' },
    });

    this.calculations = new AllianceCalculations();
    this.onStateChange = null;
    this.onError = null;
  }

  /**
   * Create new alliance
   */
  createAlliance(allianceName, leaderFactionId) {
    if (this.state.get('isLocked')) {
      throw new Error('Alliance system is locked');
    }

    const allianceId = `alliance_${allianceName.replace(/\s+/g, '_')}_${Date.now()}`;
    const alliance = {
      id: allianceId,
      name: allianceName,
      leader: leaderFactionId,
      founded: Date.now(),
      members: [leaderFactionId],
      treasury: { credits: 1000, minerals: 500, energy: 300 },
      policies: {
        name: allianceName,
        rules: 'Default alliance rules',
        votingThreshold: 50, // 50% majority
      },
    };

    const alliances = this.state.get('alliances');
    alliances[allianceId] = alliance;
    this.state.set('alliances', alliances);

    // Add leader as member
    const members = this.state.get('members');
    members[leaderFactionId] = {
      allianceId,
      rank: 'leader',
      joinedAt: Date.now(),
      contributes: true,
    };
    this.state.set('members', members);

    const treasury = this.state.get('treasury');
    treasury[allianceId] = { credits: 1000, minerals: 500, energy: 300 };
    this.state.set('treasury', treasury);

    this.state.set('totalAlliances', this.state.get('totalAlliances') + 1);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('alliance:created', {
        allianceId,
        allianceName,
        leader: leaderFactionId,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'alliance-created', alliance });
  }

  /**
   * Invite faction to alliance
   */
  inviteMember(allianceId, factionId) {
    if (this.state.get('isLocked')) {
      throw new Error('Alliance system is locked');
    }

    const alliances = this.state.get('alliances');
    const alliance = alliances[allianceId];

    if (!alliance) {
      throw new Error(`Alliance ${allianceId} not found`);
    }

    if (alliance.members.includes(factionId)) {
      throw new Error(`Faction ${factionId} already in alliance`);
    }

    alliance.members.push(factionId);
    alliances[allianceId] = alliance;
    this.state.set('alliances', alliances);

    // Add member
    const members = this.state.get('members');
    members[factionId] = {
      allianceId,
      rank: 'member',
      joinedAt: Date.now(),
      contributes: true,
    };
    this.state.set('members', members);

    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('alliance:member-joined', {
        allianceId,
        factionId,
        rank: 'member',
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'member-joined', allianceId, factionId });
  }

  /**
   * Contribute resources to alliance treasury
   */
  contributeToTreasury(allianceId, factionId, credits = 0, minerals = 0, energy = 0) {
    if (this.state.get('isLocked')) {
      throw new Error('Alliance system is locked');
    }

    const members = this.state.get('members');
    const member = members[factionId];

    if (!member || member.allianceId !== allianceId) {
      throw new Error(`Faction ${factionId} not in alliance ${allianceId}`);
    }

    const treasury = this.state.get('treasury');
    treasury[allianceId].credits += credits;
    treasury[allianceId].minerals += minerals;
    treasury[allianceId].energy += energy;
    this.state.set('treasury', treasury);

    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('alliance:contributed', {
        allianceId,
        factionId,
        credits,
        minerals,
        energy,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'contribution', allianceId });
  }

  /**
   * Propose alliance vote
   */
  proposeVote(allianceId, topic, description) {
    if (this.state.get('isLocked')) {
      throw new Error('Alliance system is locked');
    }

    const voteId = `vote_${allianceId}_${Date.now()}`;
    const votes = this.state.get('votes');

    votes[voteId] = {
      id: voteId,
      allianceId,
      topic,
      description,
      yesVotes: 0,
      noVotes: 0,
      status: 'active', // 'active', 'passed', 'failed'
      createdAt: Date.now(),
    };

    this.state.set('votes', votes);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('alliance:vote-proposed', {
        voteId,
        allianceId,
        topic,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'vote-proposed', voteId });
  }

  /**
   * Cast vote
   */
  castVote(voteId, factionId, voteYes) {
    if (this.state.get('isLocked')) {
      throw new Error('Alliance system is locked');
    }

    const votes = this.state.get('votes');
    const vote = votes[voteId];

    if (!vote) {
      throw new Error(`Vote ${voteId} not found`);
    }

    if (vote.status !== 'active') {
      throw new Error(`Vote ${voteId} is not active`);
    }

    if (voteYes) {
      vote.yesVotes += 1;
    } else {
      vote.noVotes += 1;
    }

    // Simple majority check
    const totalVotes = vote.yesVotes + vote.noVotes;
    const alliances = this.state.get('alliances');
    const alliance = alliances[vote.allianceId];

    if (totalVotes >= alliance.members.length) {
      // All members voted
      const threshold = alliance.policies.votingThreshold;
      const yesPercentage = (vote.yesVotes / totalVotes) * 100;

      if (yesPercentage >= threshold) {
        vote.status = 'passed';

        if (this.eventBus) {
          this.eventBus.emit('alliance:vote-passed', {
            voteId,
            topic: vote.topic,
            timestamp: Date.now(),
          });
        }
      } else {
        vote.status = 'failed';

        if (this.eventBus) {
          this.eventBus.emit('alliance:vote-failed', {
            voteId,
            topic: vote.topic,
            timestamp: Date.now(),
          });
        }
      }
    }

    votes[voteId] = vote;
    this.state.set('votes', votes);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);
  }

  /**
   * Get alliance details
   */
  getAlliance(allianceId) {
    return this.state.get('alliances')?.[allianceId] || null;
  }

  /**
   * Get all alliances
   */
  getAllAlliances() {
    return Object.values(this.state.get('alliances') || {});
  }

  /**
   * Get member details
   */
  getMember(factionId) {
    return this.state.get('members')?.[factionId] || null;
  }

  /**
   * Get alliance members
   */
  getAllianceMembers(allianceId) {
    const alliance = this.getAlliance(allianceId);
    if (!alliance) return [];
    return alliance.members;
  }

  /**
   * Get treasury details
   */
  getTreasury(allianceId) {
    return this.state.get('treasury')?.[allianceId] || null;
  }

  /**
   * Lock/unlock
   */
  lock() {
    this.state.set('isLocked', true);
    if (this.eventBus) this.eventBus.emit('alliance:locked', {});
    if (this.onStateChange) this.onStateChange({ type: 'locked' });
  }

  unlock() {
    this.state.set('isLocked', false);
    if (this.eventBus) this.eventBus.emit('alliance:unlocked', {});
    if (this.onStateChange) this.onStateChange({ type: 'unlocked' });
  }

  /**
   * Save/Load
   */
  async save() {
    if (!this.repository) return;
    try {
      await this.repository.save('alliance-state', this.state.clone());
      this.state.set('isDirty', false);
      if (this.eventBus) this.eventBus.emit('alliance:saved', {});
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  async load() {
    if (!this.repository) return;
    try {
      const data = await this.repository.load('alliance-state');
      if (data) {
        this.state = new State(data, this.state.schema);
      }
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  getState() {
    return this.state.clone();
  }
}

/**
 * AllianceCalculations - Pure math
 */
class AllianceCalculations {
  /**
   * Calculate alliance power (based on member count and treasury)
   */
  calculateAlliancePower(memberCount, treasury) {
    const treasuryScore = (treasury.credits + treasury.minerals * 2 + treasury.energy) / 100;
    return memberCount * 10 + treasuryScore;
  }

  /**
   * Calculate member contribution percentage
   */
  calculateContributionPercentage(memberContribution, allianceTreasury) {
    const total = memberContribution + allianceTreasury;
    return total > 0 ? (memberContribution / total) * 100 : 0;
  }

  /**
   * Calculate vote outcome
   */
  calculateVoteOutcome(yesVotes, noVotes, threshold) {
    const total = yesVotes + noVotes;
    if (total === 0) return 'pending';

    const percentage = (yesVotes / total) * 100;
    return percentage >= threshold ? 'passed' : 'failed';
  }
}

export { AllianceCalculations };
