class Node {
    constructor(id) {
        this.id = id;
        this.child = new Map()
        this.failure = null
        this.pattern = null
    }

    has_next(char) {
        return this.child.has(char);
    }

    is_terminal() {
        return this.child.size === 0;
    }
}
class AhoCorasick {

    constructor(patterns) {
        this.states = [new Node(0)];
        this.output = [[]];
        this.make_goto(patterns);
        //this.make_failure();
    }

    make_goto(patterns) {
        for (let i = 0; i < patterns.length; i++) {
            let current_state = this.states[0];
            for (let j = 0; j < patterns[i].length; j++) {
                const char = patterns[i][j];
                if (!current_state.has_next(char)) {
                    const new_state = new Node(this.states.length);
                    current_state.child.set(char, new_state);
                    this.states.push(new_state);
                }
                current_state = current_state.child.get(char);
            }

            current_state.pattern = String(patterns[i]) // 末尾のノードにパターンを追加;
        }
    }

    make_failure() {
        const queue = [ this.states[0] ];
        while (queue.length > 0) {
            const current_state = queue.shift();
            for (let [char, next_state] of current_state.child) {
                queue.push(next_state);
                if (current_state.id === 0) {
                    next_state.failure = this.states[0];
                } else {
                    let failure_state = current_state.failure;
                    while (this.goto(failure_state, char) === null) {
                        failure_state = failure_state.failure;
                    }
                    next_state.failure = this.goto(failure_state, char);
                }
            }
        }
    }

    goto(state, char) {
        if (state.has_next(char)) {
            return state.child.get(char);
        }

        return null
    }


    match(query) {
        const result = [];
        let current_state = this.states[0] // root node
        let i = 0
        while (i < query.length) {
            // 遷移先がある場合は遷移
            console.log(i, query[i])
            let j = i
            let tmp = []
            while (this.goto(current_state, query[j]) !== null) {
                current_state = this.goto(current_state, query[j]);
                if (current_state.pattern !== null) {
                    tmp.push([j - current_state.pattern.length, j, current_state.pattern])
                }
                j++;
            }
            if (tmp.length > 0) {
                result.push(tmp[tmp.length - 1])
                i += tmp[tmp.length - 1][2].length
            } else {
                i++
            }
            current_state = this.states[0]
        }
        return result
    }
}

const aho = new AhoCorasick(['D.P.S.', '劇団M.O.P.', 'さい', 'ま', 'さいたま市', 'さいたま市営浦和球場', 'さいたま市民', '998年', '98年', '8年'])
const result = `
『'D.P.S.'』（ "Dream Program System" の略。「ディー・ピー・エス」とも読む）は、アリスソフトより発売された18禁アドベンチャーゲームのシリーズ。
`

console.log(aho.match(result))
//console.log(aho.states)

