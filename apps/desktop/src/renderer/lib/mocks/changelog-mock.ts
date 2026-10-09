/**
 * Mock implementation for changelog and release operations
 */

import type { Task } from '../../../shared/types';
import { isCompletedTask } from '../../../shared/utils/task-status';
import { mockTasks } from './mock-data';

export const changelogMock = {
  // Changelog Operations
  getChangelogDoneTasks: async (_projectId: string, tasks?: Task[]) => ({
    success: true,
    data: (tasks || mockTasks)
      .filter((t): t is Task => isCompletedTask(t.status, (t as Task).reviewReason))
      .map(t => ({
        id: t.id,
        specId: t.specId,
        title: t.title,
        description: t.description,
        completedAt: t.updatedAt,
        hasSpecs: true
      }))
  }),

  loadTaskSpecs: async () => ({
    success: true,
    data: []
  }),

  generateChangelog: async () => {
    console.warn('[Browser Mock] generateChangelog called');
    return { success: true };
  },

  saveChangelog: async () => ({
    success: true,
    data: {
      filePath: 'CHANGELOG.md',
      bytesWritten: 1024
    }
  }),

  saveChangelogImage: async () => ({
    success: true,
    data: {
      relativePath: 'images/mock-image.png',
      url: 'file:///mock/path/images/mock-image.png'
    }
  }),

  readLocalImage: async () => ({
    success: false,
    error: 'Mock: Cannot read local images in browser mode'
  }),

  readExistingChangelog: async () => ({
    success: true,
    data: {
      exists: false
    }
  }),

  suggestChangelogVersion: async () => ({
    success: true,
    data: {
      version: '1.0.0',
      reason: 'Initial release'
    }
  }),

  suggestChangelogVersionFromCommits: async () => ({
    success: true,
    data: {
      version: '1.0.0',
      reason: 'Based on commit analysis'
    }
  }),

  getChangelogBranches: async () => ({
    success: true,
    data: []
  }),

  getChangelogTags: async () => ({
    success: true,
    data: []
  }),

  getChangelogCommitsPreview: async () => ({
    success: true,
    data: []
  }),

  onChangelogGenerationProgress: () => () => {},
  onChangelogGenerationComplete: () => () => {},
  onChangelogGenerationError: () => () => {}
};
