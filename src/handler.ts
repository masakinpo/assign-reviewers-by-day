import { Octokit } from '@octokit/rest';
import { debug, info } from '@actions/core';
import { format } from 'date-fns';
import _ from 'lodash';
import { Config, dayOfWeek, NumOfReviewersType, ReviewerType } from './config';

type ReviewerDict<T extends string> = {
  [key in T]: {
    [key in typeof dayOfWeek[number]]: ReviewerType<T>[];
  };
};

export const generateDictFromConfig = <T extends string>(
  reviewers: ReviewerType<T>[]
): ReviewerDict<T> => {
  const groups = _.uniq<T>(reviewers.map((r) => r.group));
  const reviewerDict = {};
  groups.forEach((g) => {
    dayOfWeek.forEach((d) => {
      const availableReviewers = reviewers
        .filter((r) => r.group === g)
        .filter(
          (r) =>
            !r.day ||
            r.day.includes(d) ||
            r.day.includes('everyday') ||
            ((d === 'sat' || d === 'sun') && r.day.includes('weekend')) ||
            (d !== 'sat' && d !== 'sun' && r.day.includes('weekday'))
        );
      _.set<ReviewerDict<typeof groups[number]>>(
        reviewerDict,
        [g, d],
        availableReviewers
      );
    });
  });
  return reviewerDict as ReviewerDict<typeof groups[number]>;
};

export const selectReviewers = <T extends string>(
  numOfReviewers: NumOfReviewersType<T>[],
  reviewers: ReviewerType<T>[],
  PR: PR
): string[] => {
  const reviewerDict = generateDictFromConfig<T>(reviewers);
  let selectedReviewers: string[] = [];
  (Object.keys(reviewerDict) as T[]).forEach((group) => {
    const availableNames = reviewerDict[group][
      format(new Date(), 'iii').toLowerCase() as typeof dayOfWeek[number]
    ]
      .filter((r) => r.name !== PR.user.login)
      .map((r) => r.name);
    const namesOfAlreadyRequestedReviewers = _.intersection(
      PR.requested_reviewers.map((r) => r.login),
      availableNames
    );
    selectedReviewers = [
      ...selectedReviewers,
      ..._.sampleSize<string>(
        availableNames.filter(
          (r) => !namesOfAlreadyRequestedReviewers.includes(r)
        ),
        numOfReviewers.find((r) => !!r[group])![group] -
          namesOfAlreadyRequestedReviewers.length
      ),
    ];
  });
  return selectedReviewers;
};

const setReviewers = async (
  octokit: Octokit,
  reviewers: string[]
): Promise<void> => {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  const pr = Number(
    (process.env.GITHUB_REF || '').split('refs/pull/')[1].split('/')[0]
  );

  const result = await octokit.pulls.createReviewRequest({
    owner,
    repo,
    reviewers,
    pull_number: pr,
  });
  debug(JSON.stringify(result));
};

export type PR = {
  user: {
    login: string;
  };
  title: string;
  // eslint-disable-next-line camelcase
  requested_reviewers: {
    login: string;
  }[];
  draft: boolean;
};

const getPR = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  prNum: number
): Promise<PR | null> => {
  const { data } = await octokit.pulls.get({
    owner,
    repo,
    // eslint-disable-next-line camelcase
    pull_number: prNum,
  });
  return data;
};

export const skipCondition = (PR: PR | null): boolean => {
  if (!PR) {
    return true;
  }
  // if PR is draft, skip
  if (PR.draft) {
    return true;
  }
  // if PR's title contains WIP/wip, skip
  if (PR.title.includes('WIP') || PR.title.includes('wip')) {
    return true;
  }
  return false;
};

export const assignReviewers = async (
  octokit: Octokit,
  config: Config<string[]>
): Promise<void> => {
  const { numOfReviewers, reviewers } = config;
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  const prNum = Number(
    (process.env.GITHUB_REF || '').split('refs/pull/')[1].split('/')[0]
  );
  const PR: PR | null = await getPR(octokit, owner, repo, prNum);
  if (skipCondition(PR)) {
    info(`skip to assign reviewers`);
    return;
  }
  const nameOfSelectedReviewers = selectReviewers(
    numOfReviewers,
    reviewers,
    PR!
  );
  if (nameOfSelectedReviewers.length > 0) {
    info(
      `Added reviewers to PR #${prNum}: ${nameOfSelectedReviewers.join(', ')}`
    );
    await setReviewers(octokit, nameOfSelectedReviewers);
  } else {
    info(`Added no reviewers`);
  }
};
