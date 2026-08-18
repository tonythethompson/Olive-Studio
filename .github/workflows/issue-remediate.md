name: Run mini-swe-agent on New Issues or Comment Trigger

on:
  # Triggers immediately when a fresh issue is opened
  issues:
    types: [opened]
  # Triggers when a comment is added to an existing issue
  issue_comment:
    types: [created]

jobs:
  solve-issue:
    # RUN IF: It is a brand new issue OR the comment contains exactly "/solve"
    if: |
      github.event_name == 'issues' || 
      (github.event_name == 'issue_comment' && github.event.comment.body == '/solve')
    
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write

    steps:
      - name: Checkout repository code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install mini-swe-agent
        run: |
          python -m pip install --upgrade pip
          pip install pipx
          pipx ensurepath
          pipx install mini-swe-agent

      # Fetch the underlying issue text if triggered by an issue_comment event
      - name: Fetch Issue Data (for comment triggers)
        if: github.event_name == 'issue_comment'
        id: get-issue
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          # Use GitHub CLI to get issue details since the comment payload has limited issue data
          ISSUE_DATA=$(gh issue view ${{ github.event.issue.number }} --json title,body)
          TITLE=$(echo "$ISSUE_DATA" | jq -r '.title')
          BODY=$(echo "$ISSUE_DATA" | jq -r '.body')
          
          # Save variables to GitHub Environment for the next step to consume safely
          echo "ISSUE_TITLE=$TITLE" >> $GITHUB_ENV
          echo "ISSUE_BODY=$BODY" >> $GITHUB_ENV

      - name: Execute mini-swe-agent via Cloudflare
        env:
          CLOUDFLARE_API_KEY: "${{ secrets.CLOUDFLARE_API_TOKEN }}"
          CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}"
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Fallback logic to grab the text from the opened issue context OR the environment step above
          TASK_TITLE: ${{ github.event.issue.title || env.ISSUE_TITLE }}
          TASK_BODY: ${{ github.event.issue.body || env.ISSUE_BODY }}
        run: |
          mini \
            --task "$TASK_TITLE\n\n$TASK_BODY" \
            --model "cloudflare/@cf/zai-org/glm-5.2" \
            --yolo
          
      - name: Create Pull Request with Fix
        uses: peter-evans/create-pull-request@v6
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          commit-message: "fix: automatically resolved by mini-swe-agent using GLM 5.2"
          title: "🤖 GLM 5.2 Fix for Issue #${{ github.event.issue.number }}"
          body: "This PR was generated automatically by mini-swe-agent using GLM 5.2 via Cloudflare Workers AI."
          branch: "mini-swe/fix-issue-${{ github.event.issue.number }}"
          delete-branch: true
